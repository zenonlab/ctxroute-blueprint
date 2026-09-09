mod manifest;

use std::{env, path::PathBuf};

use anyhow::{Context, Result, bail};
use bevy::{
    asset::AssetPlugin,
    input::mouse::{MouseMotion, MouseWheel},
    prelude::*,
    window::WindowPlugin,
    winit::WinitSettings,
};
use manifest::ValidatedPack;

#[derive(Resource)]
struct ViewerConfig {
    asset: String,
    scene_index: usize,
    scale: f32,
    camera_position: Vec3,
    camera_target: Vec3,
}

#[derive(Resource)]
struct OrbitCamera {
    target: Vec3,
    yaw: f32,
    pitch: f32,
    radius: f32,
}

#[derive(Component)]
struct ViewerCamera;

fn main() -> Result<()> {
    let pack_path = pack_path_from_args()?;
    let pack = ValidatedPack::load(&pack_path)?;
    let title = format!("Theme Preview — {}", pack.manifest.display_name);
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

    eprintln!(
        "loading theme {} from {} with {} declared capabilities",
        pack.manifest.id,
        pack.root.display(),
        pack.manifest.capabilities.len()
    );

    App::new()
        .insert_resource(WinitSettings::desktop_app())
        .insert_resource(ClearColor(Color::srgb(0.018, 0.026, 0.042)))
        .insert_resource(ViewerConfig {
            asset: pack.manifest.scene.asset,
            scene_index: pack.manifest.scene.scene_index,
            scale: pack.manifest.scene.scale,
            camera_position: initial_position,
            camera_target: target,
        })
        .insert_resource(OrbitCamera {
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

fn setup(mut commands: Commands, asset_server: Res<AssetServer>, config: Res<ViewerConfig>) {
    commands.spawn((
        WorldAssetRoot(
            asset_server
                .load(GltfAssetLabel::Scene(config.scene_index).from_asset(config.asset.clone())),
        ),
        Transform::from_scale(Vec3::splat(config.scale)),
    ));
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
        Transform::from_translation(config.camera_position)
            .looking_at(config.camera_target, Vec3::Y),
        ViewerCamera,
    ));
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
