D&D TikTok Ver25.81 complete delta sharing

1. Run SUPABASE_SHARE_SETUP.sql once in Supabase SQL Editor.
2. After it succeeds, upload the remaining app files to GitHub Pages.
3. Open reset.html once on Android and iPhone.

Sharing design:
- Entries: app_entry_records, one row per entry, including tombstones for deletion.
- Devices/invites/settings: app_meta_state, without the large entries array.
- The 5.8 MB parent snapshot is not polled every 3 seconds.
- Failed deletes are rolled back locally instead of silently reappearing later.


Ver25.83: cache-bust backend-config/app-cloud-bridge to force the deployed sharing engine to load. No sync logic changes.
