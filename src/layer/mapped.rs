use niri_config::utils::MergeWith as _;
use niri_config::{Blur, Config, LayerRule};
use smithay::backend::renderer::element::surface::{
    render_elements_from_surface_tree, WaylandSurfaceRenderElement,
};
use smithay::backend::renderer::element::Kind;
use smithay::desktop::{LayerSurface, PopupManager};
use smithay::utils::{Logical, Point, Rectangle, Scale, Size, Transform};
use smithay::wayland::shell::wlr_layer::{ExclusiveZone, Layer};

use super::ResolvedLayerRules;
use crate::animation::Clock;
use crate::layout::shadow::Shadow;
use crate::niri_render_elements;
use crate::render_helpers::blur::element::BlurRenderElement;
use crate::render_helpers::blur::EffectsFramebuffers;
use crate::render_helpers::renderer::NiriRenderer;
use crate::render_helpers::shadow::ShadowRenderElement;
use crate::render_helpers::solid_color::{SolidColorBuffer, SolidColorRenderElement};
use crate::render_helpers::surface::push_elements_from_surface_tree;
use crate::render_helpers::{render_to_texture, RenderTarget};
use crate::utils::{baba_is_float_offset, round_logical_in_physical};
use smithay::backend::allocator::Fourcc;
use smithay::backend::renderer::gles::GlesRenderer;
use std::cell::RefCell;
use std::rc::Rc;

type EffectsFramebufffersUserData = Rc<RefCell<EffectsFramebuffers>>;

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

    /// The view size for the layer surface's output.
    view_size: Size<f64, Logical>,

    /// Scale of the output the layer surface is on (and rounds its sizes to).
    scale: f64,

    size: Size<f64, Logical>,

    /// Clock for driving animations.
    clock: Clock,

    blur_config: Blur,
}

niri_render_elements! {
    LayerSurfaceRenderElement<R> => {
        Wayland = WaylandSurfaceRenderElement<R>,
        SolidColor = SolidColorRenderElement,
        Shadow = ShadowRenderElement,
        Blur = BlurRenderElement,
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

        let mut blur_config = config.layout.blur;
        blur_config.on = false;
        blur_config.merge_with(&rules.blur);

        Self {
            surface,
            rules,
            block_out_buffer: SolidColorBuffer::new((0., 0.), [0., 0., 0., 1.]),
            view_size,
            scale,
            shadow: Shadow::new(shadow_config),
            clock,
            blur_config,
            size: Size::default(),
        }
    }

    pub fn update_config(&mut self, config: &Config) {
        let mut shadow_config = config.layout.shadow;
        // Shadows for layer surfaces need to be explicitly enabled.
        shadow_config.on = false;
        shadow_config.merge_with(&self.rules.shadow);
        self.shadow.update_config(shadow_config);
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

        self.size = size;

        self.block_out_buffer.resize(size);

        let radius = self.rules.geometry_corner_radius.unwrap_or_default();
        // FIXME: is_active based on keyboard focus?
        self.shadow.update_render_elements(
            Rectangle::new(Point::new(0., 0.), size),
            true,
            radius,
            self.scale,
            1.,
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
        renderer: &mut R,
        location: Point<f64, Logical>,
        target: RenderTarget,
        fx_buffers: Option<EffectsFramebufffersUserData>,
        push: &mut dyn FnMut(LayerSurfaceRenderElement<R>),
    ) {
        let mut gles_elems: Option<Vec<LayerSurfaceRenderElement<GlesRenderer>>> = None;

        let scale = Scale::from(self.scale);
        let alpha = self.rules.opacity.unwrap_or(1.).clamp(0., 1.);
        let location = location + self.bob_offset();

        if target.should_block_out(self.rules.block_out_from) {
            if !matches!(self.rules.transparent_block, Some(true)) {
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
                renderer,
                surface,
                buf_pos.to_physical_precise_round(scale),
                scale,
                alpha,
                Kind::ScanoutCandidate,
                &mut |elem| push(elem.into()),
            );

            gles_elems = Some(render_elements_from_surface_tree(
                renderer.as_gles_renderer(),
                surface,
                buf_pos.to_physical_precise_round(scale),
                scale,
                alpha,
                Kind::ScanoutCandidate,
            ));

            if self.blur_config.on && matches!(self.surface.layer(), Layer::Top | Layer::Overlay) {
                if let Some(fx_buffers) = fx_buffers {
                    let fx_buffers_rc = fx_buffers;
                    let fx_buffers = fx_buffers_rc.borrow();
    
                    // debug!("render layer blur {:?}", self.rules.blur);
                    // TODO: respect sync point?
                    let alpha_tex = gles_elems
                        .and_then(|gles_elems| {
                            let transform = fx_buffers.transform();
    
                            render_to_texture(
                                renderer.as_gles_renderer(),
                                transform.transform_size(fx_buffers.output_size()),
                                self.scale.into(),
                                Transform::Normal,
                                Fourcc::Abgr8888,
                                gles_elems.into_iter(),
                            )
                            .inspect_err(|e| warn!("failed to render alpha tex: {e:?}"))
                            .ok()
                        })
                        .map(|r| r.0);
    
                    // let radius = self.rules.geometry_corner_radius.unwrap_or_default();
    
                    let blur_sample_area = Rectangle::new(location, self.size).to_i32_round();
    
                    let blur_elem = BlurRenderElement::new(
                        renderer,
                        fx_buffers_rc.clone(),
                        blur_sample_area,
                        location.to_physical_precise_round(self.scale),
                        self.rules
                            .geometry_corner_radius
                            .unwrap_or_default()
                            .top_left,
                        false,
                        self.scale,
                        self.blur_config,
                        1.,
                        alpha_tex,
                    )
                    .into();
    
                    push(blur_elem);
                }
            }
        }

        let location = location.to_physical_precise_round(scale).to_logical(scale);
        self.shadow
            .render(renderer, location, &mut |elem| push(elem.into()));
    }

    pub fn render_popups<R: NiriRenderer>(
        &self,
        renderer: &mut R,
        location: Point<f64, Logical>,
        target: RenderTarget,
        fx_buffers: Option<EffectsFramebufffersUserData>,
        push: &mut dyn FnMut(LayerSurfaceRenderElement<R>),
    ) {
        let scale = Scale::from(self.scale);
        let alpha = self.rules.opacity.unwrap_or(1.).clamp(0., 1.);
        let location = location + self.bob_offset();

        if target.should_block_out(self.rules.block_out_from) {
            return;
        }

        // Layer surfaces don't have extra geometry like windows.
        let buf_pos = location;

        let surface = self.surface.wl_surface();
        for (popup, popup_offset) in PopupManager::popups_for_surface(surface) {
            // Layer surfaces don't have extra geometry like windows.
            let offset = popup_offset - popup.geometry().loc;

            let size = popup.geometry().size.to_f64();

            let mut gles_elems: Option<Vec<LayerSurfaceRenderElement<GlesRenderer>>> = None;

            {
                push_elements_from_surface_tree(
                    renderer,
                    popup.wl_surface(),
                    (buf_pos + offset.to_f64()).to_physical_precise_round(scale),
                    scale,
                    alpha,
                    Kind::ScanoutCandidate,
                    &mut |elem| push(elem.into()),
                );
            }

            gles_elems = Some(render_elements_from_surface_tree(
                renderer.as_gles_renderer(),
                popup.wl_surface(),
                (buf_pos + offset.to_f64()).to_physical_precise_round(scale),
                scale,
                alpha,
                Kind::ScanoutCandidate,
            ));

            if self.blur_config.on {
                if let Some(fx_buffers_rc) = fx_buffers.as_ref() {
                    let fx_buffers = fx_buffers_rc.borrow();
                    let alpha_tex = gles_elems
                        .and_then(|gles_elems| {
                            let transform = fx_buffers.transform();

                            render_to_texture(
                                renderer.as_gles_renderer(),
                                transform.transform_size(fx_buffers.output_size()),
                                scale,
                                Transform::Normal,
                                Fourcc::Abgr8888,
                                gles_elems.into_iter(),
                            )
                            .inspect_err(|e| warn!("failed to render alpha tex: {e:?}"))
                            .ok()
                        })
                        .map(|r| r.0);

                    // let radius = self.rules.geometry_corner_radius.unwrap_or_default();

                    let blur_sample_area =
                        Rectangle::new(buf_pos + offset.to_f64(), size).to_i32_round();

                    let blur_elem = BlurRenderElement::new(
                        renderer,
                        fx_buffers_rc.clone(),
                        blur_sample_area,
                        (buf_pos + offset.to_f64()).to_physical_precise_round(scale),
                        self.rules
                            .geometry_corner_radius
                            .unwrap_or_default()
                            .top_left,
                        false,
                        scale.x,
                        self.blur_config,
                        1.,
                        alpha_tex,
                    )
                    .into();

                    push(blur_elem);
                }
            }
        }
    }
}
