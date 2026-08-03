D&D❀TikTok Ver25.85

- 起動・承認時の旧5.8MB親データ pull を完全停止
- 起動後は app_entry_records / app_meta_state の差分共有のみ
- 古い dirty / recovery ロックを承認後に解除
- 直近HTTPエラーを後続ステータスで消さず保持
- 手動 syncNow も親データ送信を使わずメタ差分のみ
