D&D TikTok Ver25.86 one-time parent bootstrap + delta sharing

- Devices with complete local data skip the parent download.
- Empty/new devices download the cloud parent snapshot once, then use delta sharing only.
- Entry add/edit/delete uses app_entry_records.
- Device and invitation metadata uses app_meta_state.
