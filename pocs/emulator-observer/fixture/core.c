#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

typedef bool (*environment_t)(unsigned, void *);
typedef void (*video_t)(const void *, unsigned, unsigned, size_t);
typedef void (*audio_t)(int16_t, int16_t);
typedef size_t (*audio_batch_t)(const int16_t *, size_t);
typedef void (*input_poll_t)(void);
typedef int16_t (*input_state_t)(unsigned, unsigned, unsigned, unsigned);

struct retro_game_info { const char *path; const void *data; size_t size; const char *meta; };
struct retro_system_info {
  const char *library_name; const char *library_version; const char *valid_extensions;
  bool need_fullpath; bool block_extract;
};
struct retro_game_geometry {
  unsigned base_width, base_height, max_width, max_height; float aspect_ratio;
};
struct retro_system_timing { double fps, sample_rate; };
struct retro_system_av_info { struct retro_game_geometry geometry; struct retro_system_timing timing; };
struct fixture_state { uint32_t frame; uint32_t seed; uint32_t input_total; };

static environment_t environment_cb;
static video_t video_cb;
static audio_t audio_cb;
static audio_batch_t audio_batch_cb;
static input_poll_t input_poll_cb;
static input_state_t input_state_cb;
static struct fixture_state state;
static uint32_t pixels[16];

unsigned retro_api_version(void) { return 1; }
void retro_set_environment(environment_t cb) { environment_cb = cb; }
void retro_set_video_refresh(video_t cb) { video_cb = cb; }
void retro_set_audio_sample(audio_t cb) { audio_cb = cb; }
void retro_set_audio_sample_batch(audio_batch_t cb) { audio_batch_cb = cb; }
void retro_set_input_poll(input_poll_t cb) { input_poll_cb = cb; }
void retro_set_input_state(input_state_t cb) { input_state_cb = cb; }
void retro_set_controller_port_device(unsigned port, unsigned device) { (void)port; (void)device; }
void retro_init(void) { memset(&state, 0, sizeof(state)); }
void retro_deinit(void) {}
void retro_reset(void) { state.frame = 0; state.input_total = 0; }

void retro_get_system_info(struct retro_system_info *info) {
  info->library_name = "Wallpaper deterministic fixture";
  info->library_version = "1.0.0";
  info->valid_extensions = "fixture";
  info->need_fullpath = false;
  info->block_extract = true;
}

void retro_get_system_av_info(struct retro_system_av_info *info) {
  info->geometry = (struct retro_game_geometry){4, 4, 4, 4, 1.0f};
  info->timing = (struct retro_system_timing){60.0, 240.0};
}

bool retro_load_game(const struct retro_game_info *game) {
  if (!game || !game->data || game->size == 0) return false;
  state.seed = 2166136261u;
  const uint8_t *bytes = (const uint8_t *)game->data;
  for (size_t i = 0; i < game->size; ++i) state.seed = (state.seed ^ bytes[i]) * 16777619u;
  unsigned xrgb8888 = 1;
  return environment_cb && environment_cb(10, &xrgb8888);
}

void retro_unload_game(void) {}
size_t retro_serialize_size(void) { return sizeof(state); }
bool retro_serialize(void *data, size_t size) {
  if (!data || size < sizeof(state)) return false;
  memcpy(data, &state, sizeof(state)); return true;
}
bool retro_unserialize(const void *data, size_t size) {
  if (!data || size != sizeof(state)) return false;
  memcpy(&state, data, sizeof(state)); return true;
}

void retro_run(void) {
  if (input_poll_cb) input_poll_cb();
  const int16_t pressed = input_state_cb ? input_state_cb(0, 1, 0, 8) : 0;
  state.input_total += pressed ? 1u : 0u;
  for (uint32_t i = 0; i < 16; ++i) {
    const uint32_t v = state.seed + state.frame * 17u + state.input_total * 31u + i;
    pixels[i] = ((v & 255u) << 16) | (((v >> 8) & 255u) << 8) | ((v >> 16) & 255u);
  }
  if (video_cb) video_cb(pixels, 4, 4, sizeof(uint32_t) * 4);
  int16_t samples[8];
  for (uint32_t i = 0; i < 4; ++i) {
    const int16_t value = (int16_t)((state.frame * 97u + i * 13u + state.input_total) & 0x7fffu);
    samples[i * 2] = value; samples[i * 2 + 1] = (int16_t)-value;
  }
  if (audio_batch_cb) audio_batch_cb(samples, 4);
  else if (audio_cb) for (uint32_t i = 0; i < 4; ++i) audio_cb(samples[i * 2], samples[i * 2 + 1]);
  state.frame++;
}

void *retro_get_memory_data(unsigned id) { return id == 0 ? &state : NULL; }
size_t retro_get_memory_size(unsigned id) { return id == 0 ? sizeof(state) : 0; }
unsigned retro_get_region(void) { return 0; }
void retro_cheat_reset(void) {}
void retro_cheat_set(unsigned index, bool enabled, const char *code) {
  (void)index; (void)enabled; (void)code;
}
bool retro_load_game_special(unsigned type, const struct retro_game_info *info, size_t count) {
  (void)type; (void)info; (void)count; return false;
}
