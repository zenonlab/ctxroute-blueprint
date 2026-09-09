mod manifest;

use std::{env, path::PathBuf};

use anyhow::{Context, Result, bail};
use bevy::{
    asset::AssetPlugin,
    input::mouse::{MouseMotion, MouseWheel},
    prelude::*,
    window::WindowPlugin,
    winit::WinitSettings,
    world_serialization::WorldInstanceReady,
};
use manifest::{AnimationDescriptor, TransformDescriptor, ValidatedPack};

#[derive(Clone)]
struct RenderableInstance {
    id: String,
    asset: String,
    scene_index: usize,
    transform: TransformDescriptor,
    animation: Option<AnimationDescriptor>,
}

#[derive(Resource)]
struct ViewerConfig {
    instances: Vec<RenderableInstance>,
    camera_position: Vec3,
    camera_target: Vec3,
    camera_fov_y_degrees: f32,
}

#[derive(Resource)]
struct OrbitCamera {
    enabled: bool,
    target: Vec3,
    yaw: f32,
    pitch: f32,
    radius: f32,
}

#[derive(Component)]
struct ViewerCamera;

#[derive(Component, Clone)]
struct InstanceAnimation {
    graph: Handle<AnimationGraph>,
    node: AnimationNodeIndex,
    repeat: bool,
    speed: f32,
}

fn main() -> Result<()> {
    let pack_path = pack_path_from_args()?;
    let pack = ValidatedPack::load(&pack_path)?;
    let diagnostic = pack.is_visual_diagnostic();
    let title = if diagnostic {
        format!("DIAGNOSTIC ONLY — {}", pack.manifest.display_name)
    } else {
        format!("Theme Preview — {}", pack.manifest.display_name)
    };
    let initial_position = Vec3::from_array(pack.manifest.camera.position);
    let target = Vec3::from_array(pack.manifest.camera.target);
    let offset = initial_position - target;
    let radius = offset.length().max(0.1);
    let yaw = offset.x.atan2(offset.z);
    let pitch = (offset.y / radius).asin();
    let root = pack
        .root
        .to_str()
        .context("pack path is not valid UTF-8")?
        .to_owned();
    let instances = pack
        .manifest
        .instances
        .iter()
        .map(|instance| {
            let asset = &pack.manifest.assets[&instance.asset];
            RenderableInstance {
                id: instance.id.clone(),
                asset: asset.path.clone(),
                scene_index: asset.scene_index,
                transform: instance.transform.clone(),
                animation: instance.animation.clone(),
            }
        })
        .collect();

    eprintln!(
        "loading theme {} from {} with {} declared capabilities",
        pack.manifest.id,
        pack.root.display(),
        pack.manifest.capabilities.len()
    );
    if diagnostic {
        eprintln!(
            "warning: this pack contains a semantic-to-render profile conversion and is not a visual-fidelity proof"
        );
    }

    App::new()
        .insert_resource(WinitSettings::desktop_app())
        .insert_resource(ClearColor(Color::srgb(0.018, 0.026, 0.042)))
        .insert_resource(ViewerConfig {
            instances,
            camera_position: initial_position,
            camera_target: target,
            camera_fov_y_degrees: pack.manifest.camera.fov_y_degrees,
        })
        .insert_resource(OrbitCamera {
            enabled: pack.manifest.camera.orbit_enabled,
            target,
            yaw,
            pitch,
            radius,
        })
        .add_plugins(
            DefaultPlugins
                .set(AssetPlugin {
                    file_path: root,
                    ..default()
                })
                .set(ImagePlugin::default_nearest())
                .set(WindowPlugin {
                    primary_window: Some(Window {
                        title,
                        resolution: (1280, 720).into(),
                        ..default()
                    }),
                    ..default()
                }),
        )
        .add_systems(Startup, setup)
        .add_systems(Update, orbit_camera)
        .run();

    Ok(())
}

fn pack_path_from_args() -> Result<PathBuf> {
    let mut args = env::args_os().skip(1);
    match (args.next(), args.next(), args.next()) {
        (Some(flag), Some(path), None) if flag == "--pack" => Ok(path.into()),
        _ => bail!("usage: game-theme-viewer --pack <theme-pack-directory>"),
    }
}

fn setup(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    mut animation_graphs: ResMut<Assets<AnimationGraph>>,
    config: Res<ViewerConfig>,
) {
    for instance in &config.instances {
        let mut entity = commands.spawn((
            Name::new(instance.id.clone()),
            WorldAssetRoot(asset_server.load(
                GltfAssetLabel::Scene(instance.scene_index).from_asset(instance.asset.clone()),
            )),
            descriptor_transform(&instance.transform),
        ));
        if let Some(animation) = &instance.animation
            && animation.autoplay
        {
            let clip = asset_server.load(
                GltfAssetLabel::Animation(animation.clip_index).from_asset(instance.asset.clone()),
            );
            let (graph, node) = AnimationGraph::from_clip(clip);
            entity
                .insert(InstanceAnimation {
                    graph: animation_graphs.add(graph),
                    node,
                    repeat: animation.repeat,
                    speed: animation.speed,
                })
                .observe(play_instance_animation);
        }
    }
    commands.spawn((
        DirectionalLight {
            illuminance: 8_000.0,
            shadow_maps_enabled: false,
            ..default()
        },
        Transform::from_xyz(8.0, 16.0, 10.0).looking_at(config.camera_target, Vec3::Y),
    ));
    commands.spawn((
        Camera3d::default(),
        Projection::Perspective(PerspectiveProjection {
            fov: config.camera_fov_y_degrees.to_radians(),
            ..default()
        }),
        Transform::from_translation(config.camera_position)
            .looking_at(config.camera_target, Vec3::Y),
        ViewerCamera,
    ));
}

fn descriptor_transform(descriptor: &TransformDescriptor) -> Transform {
    let [x, y, z] = descriptor.rotation_degrees.map(f32::to_radians);
    Transform {
        translation: Vec3::from_array(descriptor.translation),
        rotation: Quat::from_euler(EulerRot::XYZ, x, y, z),
        scale: Vec3::from_array(descriptor.scale),
    }
}

fn play_instance_animation(
    ready: On<WorldInstanceReady>,
    mut commands: Commands,
    children: Query<&Children>,
    requests: Query<&InstanceAnimation>,
    mut players: Query<&mut AnimationPlayer>,
) {
    let Ok(request) = requests.get(ready.entity) else {
        return;
    };
    for child in children.iter_descendants(ready.entity) {
        let Ok(mut player) = players.get_mut(child) else {
            continue;
        };
        commands
            .entity(child)
            .insert(AnimationGraphHandle(request.graph.clone()));
        let active = player.play(request.node).set_speed(request.speed);
        if request.repeat {
            active.repeat();
        }
    }
}

fn orbit_camera(
    buttons: Res<ButtonInput<MouseButton>>,
    keys: Res<ButtonInput<KeyCode>>,
    mut motion: MessageReader<MouseMotion>,
    mut wheel: MessageReader<MouseWheel>,
    config: Res<ViewerConfig>,
    mut orbit: ResMut<OrbitCamera>,
    mut cameras: Query<&mut Transform, With<ViewerCamera>>,
) {
    if !orbit.enabled {
        motion.clear();
        wheel.clear();
        return;
    }
    let mut changed = false;
    if buttons.pressed(MouseButton::Left) {
        for event in motion.read() {
            orbit.yaw -= event.delta.x * 0.005;
            orbit.pitch = (orbit.pitch + event.delta.y * 0.005).clamp(-1.45, 1.45);
            changed = true;
        }
    } else {
        motion.clear();
    }
    for event in wheel.read() {
        orbit.radius = (orbit.radius * (1.0 - event.y * 0.08)).clamp(0.25, 500.0);
        changed = true;
    }
    if keys.just_pressed(KeyCode::KeyR) {
        let offset = config.camera_position - config.camera_target;
        orbit.target = config.camera_target;
        orbit.radius = offset.length().max(0.1);
        orbit.yaw = offset.x.atan2(offset.z);
        orbit.pitch = (offset.y / orbit.radius).asin();
        changed = true;
    }
    if !changed {
        return;
    }

    let direction = Vec3::new(
        orbit.yaw.sin() * orbit.pitch.cos(),
        orbit.pitch.sin(),
        orbit.yaw.cos() * orbit.pitch.cos(),
    );
    for mut transform in &mut cameras {
        *transform = Transform::from_translation(orbit.target + direction * orbit.radius)
            .looking_at(orbit.target, Vec3::Y);
    }
}
