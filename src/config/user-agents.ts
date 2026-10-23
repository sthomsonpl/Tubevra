// Keep the supplied values verbatim. Built-ins are never persisted or edited.
export const USER_AGENT_PRESETS = Object.freeze({
  ps4: 'Mozilla/5.0 (PS4; Leanback Shell) Cobalt/26.lts.0-qa; compatible;',
  cobalt:
    'Mozilla/5.0 (Linux arm64-v8a; Android 14) Cobalt/26.android.1.1036487-gold (unlike Gecko) v8/11.4.183.40-jit gles Starboard/17, Google_ATV_sabrina_2020/UTTC.250917.004 (google, Chromecast) com.google.android.youtube.tv/5.30.301',
  tizen:
    'Mozilla/5.0 (SMART-TV; LINUX; Tizen 7.0) Cobalt/24.lts.10.1032622-gold, PONTUSM_TV_PONTUSM_2024/1120.6 (Samsung, QA65LS03DAWXXY, Wired)',
  lg_webos:
    'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.31 Safari/537.36 WebAppManager',
  xbox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox Series X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36 Cobalt/24.lts.10.1032622-gold',
  firetv:
    'Mozilla/5.0 (Linux; Android 11; AFTMM) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.31 Safari/537.36 Cobalt/24.lts.10.1032622-gold',
  apple_tv:
    'Mozilla/5.0 (AppleTV; tvOS/17.0) AppleWebKit/605.1.15 (KHTML, like Gecko) Cobalt/24.lts.10.1032622-gold Safari/605.1.15',
});

export const DEFAULT_USER_AGENT_ID = 'ps4';

export const USER_AGENT_NAMES = Object.freeze({
  ps4: 'PlayStation 4',
  cobalt: 'Google TV / Cobalt',
  tizen: 'Samsung / Tizen',
  lg_webos: 'LG / webOS',
  xbox: 'Xbox Series X',
  firetv: 'Amazon Fire TV',
  apple_tv: 'Apple TV',
} satisfies Record<keyof typeof USER_AGENT_PRESETS, string>);
