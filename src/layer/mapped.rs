use std::sync::Arc;

use niri_config::utils::MergeWith as _;
use niri_config::{Config, CornerRadius, LayerRule};
use smithay::backend::renderer::element::surface::{
    render_elements_from_surface_tree, WaylandSurfaceRenderElement,
};
use smithay::backend::renderer::element::Kind;
use smithay::backend::renderer::utils::RendererSurfaceStateUserData;
use smithay::desktop::{LayerSurface, PopupKind, PopupManager};
use smithay::utils::{Logical, Point, Rectangle, Scale, Size, Transform};
use smithay::wayland::compositor::with_states;
use smithay::wayland::shell::wlr_layer::{ExclusiveZone, Layer};

use super::ResolvedLayerRules;
use crate::animation::Clock;
use crate::handlers::background_effect::get_cached_blur_region;
use crate::layout::shadow::Shadow;
use crate::niri_render_elements;
use crate::render_helpers::background_effect::{BackgroundEffect, BackgroundEffectElement};
use crate::render_helpers::renderer::NiriRenderer;
use crate::render_helpers::shadow::ShadowRenderElement;
use crate::render_helpers::solid_color::{SolidColorBuffer, SolidColorRenderElement};
use crate::render_helpers::surface::push_elements_from_surface_tree;
use crate::render_helpers::{background_effect, render_to_texture_with_offset, RenderCtx};
use crate::utils::{baba_is_float_offset, round_logical_in_physical};
use smithay::backend::allocator::Fourcc;
use smithay::backend::renderer::gles::GlesRenderer;
use smithay::reexports::wayland_server::protocol::wl_surface::WlSurface;

#[derive(Debug)]
pub struct MappedLayer {
    /// The surface itself.
    surface: LayerSurface,

    /// Up-to-date rules.
    rules: ResolvedLayerRules,

    /// Buffer to draw instead of the surface when it should be blocked out.
    block_out_buffer: SolidColorBuffer,

    /// The shadow around the surface.
    shadow: Shadow,

    /// The background effect, like blur, behind the layer-surface.
    background_effect: BackgroundEffect,

    /// The view size for the layer surface's output.
    view_size: Size<f64, Logical>,

    /// Scale of the output the layer surface is on (and rounds its sizes to).
    scale: f64,

    /// Clock for driving animations.
    clock: Clock,
}

niri_render_elements! {
    LayerSurfaceRenderElement<R> => {
        Wayland = WaylandSurfaceRenderElement<R>,
        SolidColor = SolidColorRenderElement,
        Shadow = ShadowRenderElement,
        BackgroundEffect = BackgroundEffectElement,
    }
}

impl MappedLayer {
    pub fn new(
        surface: LayerSurface,
        rules: ResolvedLayerRules,
        view_size: Size<f64, Logical>,
        scale: f64,
        clock: Clock,
        config: &Config,
    ) -> Self {
        let mut shadow_config = config.layout.shadow;

        // Shadows for layer surfaces need to be explicitly enabled.
        shadow_config.on = false;
        shadow_config.merge_with(&rules.shadow);

        let mut background_effect = BackgroundEffect::new();
        background_effect.update_config(config.blur);

        Self {
            surface,
            rules,
            block_out_buffer: SolidColorBuffer::new((0., 0.), [0., 0., 0., 1.]),
            view_size,
            scale,
            shadow: Shadow::new(shadow_config),
            background_effect,
            clock,
        }
    }

    pub fn update_config(&mut self, config: &Config) {
        let mut shadow_config = config.layout.shadow;
        // Shadows for layer surfaces need to be explicitly enabled.
        shadow_config.on = false;
        shadow_config.merge_with(&self.rules.shadow);
        self.shadow.update_config(shadow_config);

        self.background_effect.update_config(config.blur);
    }

    pub fn update_shaders(&mut self) {
        self.shadow.update_shaders();
    }

    pub fn update_sizes(&mut self, view_size: Size<f64, Logical>, scale: f64) {
        self.view_size = view_size;
        self.scale = scale;
    }

    pub fn update_render_elements(&mut self, size: Size<f64, Logical>) {
        // Round to physical pixels.
        let size = size
            .to_physical_precise_round(self.scale)
            .to_logical(self.scale);

        self.block_out_buffer.resize(size);

        let radius = self.rules.geometry_corner_radius.unwrap_or_default();
        let exponent = self.rules.exponent.unwrap_or(2.8);
        // FIXME: is_active based on keyboard focus?
        self.shadow
            .update_render_elements(size, true, radius, self.scale, 1., exponent);

        let has_blur_region = self.blur_region().is_some_and(|r| !r.is_empty());
        self.background_effect.update_render_elements(
            radius,
            self.rules.background_effect,
            has_blur_region,
        );
    }

    pub fn are_animations_ongoing(&self) -> bool {
        self.rules.baba_is_float
    }

    pub fn surface(&self) -> &LayerSurface {
        &self.surface
    }

    pub fn rules(&self) -> &ResolvedLayerRules {
        &self.rules
    }

    /// Recomputes the resolved layer rules and returns whether they changed.
    pub fn recompute_layer_rules(&mut self, rules: &[LayerRule], is_at_startup: bool) -> bool {
        let new_rules = ResolvedLayerRules::compute(rules, &self.surface, is_at_startup);
        if new_rules == self.rules {
            return false;
        }

        self.rules = new_rules;
        true
    }

    pub fn place_within_backdrop(&self) -> bool {
        if !self.rules.place_within_backdrop {
            return false;
        }

        if self.surface.layer() != Layer::Background {
            return false;
        }

        let state = self.surface.cached_state();
        if state.exclusive_zone != ExclusiveZone::DontCare {
            return false;
        }

        true
    }

    pub fn bob_offset(&self) -> Point<f64, Logical> {
        if !self.rules.baba_is_float {
            return Point::from((0., 0.));
        }

        let y = baba_is_float_offset(self.clock.now(), self.view_size.h);
        let y = round_logical_in_physical(self.scale, y);
        Point::from((0., y))
    }

    pub fn render_normal<R: NiriRenderer>(
        &self,
        mut ctx: RenderCtx<R>,
        location: Point<f64, Logical>,
        mut pos_in_backdrop: Point<f64, Logical>,
        zoom: f64,
        push: &mut dyn FnMut(LayerSurfaceRenderElement<R>),
    ) {
        let scale = Scale::from(self.scale);
        let alpha = self.rules.opacity.unwrap_or(1.).clamp(0., 1.);
        let location = location + self.bob_offset();
        pos_in_backdrop += self.bob_offset().upscale(zoom);

        if ctx.target.should_block_out(self.rules.block_out_from) {
            if let Some(true) = self.rules.transparent_block {
            } else {
                // Round to physical pixels.
                let location = location.to_physical_precise_round(scale).to_logical(scale);

                // FIXME: take geometry-corner-radius into account.
                let elem = SolidColorRenderElement::from_buffer(
                    &self.block_out_buffer,
                    location,
                    alpha,
                    Kind::Unspecified,
                );
                push(elem.into());
            }
        } else {
            // Layer surfaces don't have extra geometry like windows.
            let buf_pos = location;

            let surface = self.surface.wl_surface();
            push_elements_from_surface_tree(
                ctx.renderer,
                surface,
                buf_pos.to_physical_precise_round(scale),
                scale,
                alpha,
                Kind::ScanoutCandidate,
                &mut |elem| push(elem.into()),
            );
        }

        let location = location.to_physical_precise_round(scale).to_logical(scale);
        self.shadow
            .render(ctx.renderer, location, &mut |elem| push(elem.into()));

        if self.background_effect.is_visible() {
            let area = Rectangle::new(location, self.block_out_buffer.size());
            // Effects not requested by the surface itself are drawn to match the geometry.
            let mut clip = true;
            let mut need_ignore_alpha = true;

            // FIXME: support blur regions on subsurfaces in addition to the main surface.
            let mut subregion = None;
            let blur_geometry = if let Some(rects) = self.blur_region() {
                debug!("using surface-provided blur region for normal layer-surface {rects:?}");
                if rects.is_empty() {
                    // Surface has a set, but empty blur region.
                    None
                } else {
                    need_ignore_alpha = false;
                    // If the surface itself requests the effects, apply different defaults.
                    clip = false;
                    debug!("using surface-provided blur region for normal layer-surface");

                    // Use geometry-shaped blur for blocked-out layers to avoid unintentionally
                    // leaking any surface shapes. We render those layers as geometry-shaped solid
                    // rectangles anyway.
                    if ctx.target.should_block_out(self.rules.block_out_from) {
                        if self.rules.transparent_block.is_some() {
                            None
                        } else {
                            clip = true;
                            Some(area)
                        }
                    } else {
                        let mut main_surface_geo = self.main_surface_geo().to_f64();
                        main_surface_geo.loc += area.loc;

                        subregion = Some(background_effect::EffectSubregion {
                            rects,
                            scale: Scale::from(1.),
                            offset: main_surface_geo.loc,
                        });

                        main_surface_geo = main_surface_geo
                            .to_physical_precise_round(self.scale)
                            .to_logical(self.scale);
                        Some(main_surface_geo)
                    }
                }
            } else {
                if ctx.target.should_block_out(self.rules.block_out_from)
                    && self
                        .rules
                        .transparent_block
                        .is_some_and(|transparent_block| transparent_block == true)
                {
                    None
                } else {
                    Some(area)
                }
            };

            if let Some(geometry) = blur_geometry {
                let mut alpha_tex = None;
                let mut force_damage = false;
                if need_ignore_alpha && geometry.size.w > 0. && geometry.size.h > 0. {
                    force_damage = true;
                    // debug!("surface size {:?}", self.surface.);
                    let gles_elems: Option<Vec<LayerSurfaceRenderElement<GlesRenderer>>> =
                        Some(render_elements_from_surface_tree(
                            ctx.renderer.as_gles_renderer(),
                            self.surface.wl_surface(),
                            location.to_physical_precise_round(scale),
                            scale,
                            alpha,
                            Kind::ScanoutCandidate,
                        ));
                    // TODO: respect sync point?
                    alpha_tex = gles_elems
                        .and_then(|gles_elems| {
                            render_to_texture_with_offset(
                                ctx.renderer.as_gles_renderer(),
                                self.main_surface_geo()
                                    .size
                                    .to_physical_precise_round(scale),
                                self.scale.into(),
                                Transform::Normal,
                                Fourcc::Abgr8888,
                                gles_elems.into_iter(),
                                geometry.loc.to_physical_precise_round(self.scale),
                            )
                            .inspect_err(|e| warn!("failed to render alpha tex: {e:?}"))
                            .ok()
                        })
                        .map(|r| r.0);
                }

                pos_in_backdrop += (geometry.loc - area.loc).upscale(zoom);
                let params = background_effect::RenderParams {
                    geometry,
                    subregion,
                    clip: clip.then_some((area, CornerRadius::default())),
                    pos_in_backdrop,
                    zoom,
                    scale: self.scale,
                    alpha_tex,
                    ignore_alpha: self.rules.background_effect.ignore_alpha.unwrap_or(0.) as f32,
                    exponent: self.rules.exponent.unwrap_or(2.8) as f32,
                    offset: (0., 0.),
                    force_damage,
                };
                self.background_effect
                    .render(ctx.as_gles(), params, &mut |elem| push(elem.into()));
            }
        }
    }

    pub fn render_popups<R: NiriRenderer>(
        &self,
        mut ctx: RenderCtx<R>,
        location: Point<f64, Logical>,
        push: &mut dyn FnMut(LayerSurfaceRenderElement<R>),
    ) {
        let scale = Scale::from(self.scale);
        let alpha = self.rules.opacity.unwrap_or(1.).clamp(0., 1.);
        let location = location + self.bob_offset();

        if ctx.target.should_block_out(self.rules.block_out_from) {
            return;
        }

        // Layer surfaces don't have extra geometry like windows.
        let buf_pos = location;

        let surface = self.surface.wl_surface();
        for (popup, popup_offset) in PopupManager::popups_for_surface(surface) {
            // Layer surfaces don't have extra geometry like windows.
            let offset = popup_offset - popup.geometry().loc;

            push_elements_from_surface_tree(
                ctx.renderer,
                popup.wl_surface(),
                (buf_pos + offset.to_f64()).to_physical_precise_round(scale),
                scale,
                alpha,
                Kind::ScanoutCandidate,
                &mut |elem| push(elem.into()),
            );

            if self.background_effect.is_visible() {
                // let area = Rectangle::new(location, self.block_out_buffer.borrow().size());
                let mut main_surface_geo = popup.geometry().to_f64();
                main_surface_geo.loc = buf_pos + offset.to_f64();
                let mut need_ignore_alpha = true;

                match popup {
                    PopupKind::InputMethod(ref _t) => {
                        // main_surface_geo.loc = buf_pos;
                        main_surface_geo.size = self.block_out_buffer.size();
                        main_surface_geo.size.w -= popup_offset.x as f64;
                        main_surface_geo.size.h -= popup_offset.y as f64;
                    }
                    _ => {}
                }

                // FIXME: support blur regions on subsurfaces in addition to the main surface.
                let mut subregion = None;
                let blur_geometry =
                    if let Some(rects) = self.blur_region_surface(popup.wl_surface()) {
                        if rects.is_empty() {
                            // Surface has a set, but empty blur region.
                            None
                        } else {
                            // If the surface itself requests the effects, apply different defaults.
                            need_ignore_alpha = false;
                            subregion = Some(background_effect::EffectSubregion {
                                rects,
                                scale: Scale::from(1.),
                                offset: main_surface_geo.loc,
                            });

                            main_surface_geo = main_surface_geo
                                .to_physical_precise_round(Scale::from(scale))
                                .to_logical(Scale::from(scale));
                            Some(main_surface_geo)
                        }
                    } else {
                        Some(main_surface_geo)
                    };

                if let Some(geometry) = blur_geometry {
                    // debug!(
                    //     "render alpha_tex for popup {:?} and need ignore alpha {:?}",
                    //     geometry, need_ignore_alpha
                    // );
                    let mut alpha_tex = None;
                    if need_ignore_alpha && geometry.size.w > 0. && geometry.size.h > 0. {
                        let gles_elems: Option<Vec<LayerSurfaceRenderElement<GlesRenderer>>> =
                            Some(render_elements_from_surface_tree(
                                ctx.renderer.as_gles_renderer(),
                                popup.wl_surface(),
                                main_surface_geo.loc.to_physical_precise_round(scale),
                                scale,
                                alpha,
                                Kind::ScanoutCandidate,
                            ));

                        // TODO: respect sync point?
                        alpha_tex = gles_elems
                            .and_then(|gles_elems| {
                                render_to_texture_with_offset(
                                    ctx.renderer.as_gles_renderer(),
                                    main_surface_geo.size.to_physical_precise_round(scale),
                                    scale.into(),
                                    Transform::Normal,
                                    Fourcc::Abgr8888,
                                    gles_elems.into_iter(),
                                    main_surface_geo.loc.to_physical_precise_round(scale),
                                )
                                .inspect_err(|e| warn!("failed to render alpha tex: {e:?}"))
                                .ok()
                            })
                            .map(|r| r.0);
                    }

                    // pos_in_backdrop += (geometry.loc - area.loc).upscale(zoom);
                    let params = background_effect::RenderParams {
                        geometry,
                        subregion,
                        clip: None,
                        pos_in_backdrop: main_surface_geo.loc,
                        zoom: 1.,
                        scale: scale.x,
                        alpha_tex,
                        ignore_alpha: self.rules.background_effect.ignore_alpha.unwrap_or(0.)
                            as f32,
                        exponent: self.rules.exponent.unwrap_or(2.8) as f32,
                        offset: (-popup_offset.x as f32, -popup_offset.y as f32),
                        force_damage: true,
                    };
                    self.background_effect
                        .render(ctx.as_gles(), params, &mut |elem| push(elem.into()));
                }
            }
        }
    }

    fn main_surface_geo(&self) -> Rectangle<i32, Logical> {
        with_states(self.surface.wl_surface(), |states| {
            let data = states.data_map.get::<RendererSurfaceStateUserData>();
            data.and_then(|d| d.lock().unwrap().view())
                .map(|view| Rectangle {
                    loc: view.offset,
                    size: view.dst,
                })
        })
        .unwrap_or_default()
    }

    fn blur_region(&self) -> Option<Arc<Vec<Rectangle<i32, Logical>>>> {
        with_states(self.surface.wl_surface(), get_cached_blur_region)
    }

    fn blur_region_surface(
        &self,
        wl_surface: &WlSurface,
    ) -> Option<Arc<Vec<Rectangle<i32, Logical>>>> {
        with_states(wl_surface, get_cached_blur_region)
    }
}
