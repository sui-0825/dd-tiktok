// Android emergency solo-input mode: Android saves locally only; iPhone/cloud remain unchanged.
window.DD_ANDROID_SOLO_MODE = /Android/i.test(navigator.userAgent);
// D&D❀TikTok Ver16.2 - Supabaseクラウド接続設定済み
// Publishable keyはブラウザアプリで利用する公開用キーです。
window.DD_BACKEND_CONFIG = {
  enabled: true,
  provider: 'supabase',
  url: 'https://dqistpmkgctbzrxmrtvk.supabase.co',
  anonKey: 'sb_publishable_GngV425KVitnoGG_hZCMSA_A7G2Mlgv',
  workspaceId: 'df2e6d88-2c02-44cd-9c2d-179b86492a71'
};
