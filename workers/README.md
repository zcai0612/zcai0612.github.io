# ReadPaper API

This Worker stores ReadPaper data in Cloudflare D1 so the `/readpaper/` page can sync across browsers.

## Deploy

1. Log in:

   ```powershell
   npx wrangler login
   ```

2. Create the D1 database:

   ```powershell
   npx wrangler d1 create readpaper-db
   ```

   Copy the returned `database_id` into `wrangler.toml`.

3. Add secrets:

   ```powershell
   npx wrangler secret put READPAPER_PASSWORD_HASH
   npx wrangler secret put READPAPER_AUTH_SECRET
   ```

   Use this value for `READPAPER_PASSWORD_HASH`:

   ```text
   bb644300fbc1dc770ecb4342af41c77b97c7b72aea66ea299b64f647df8116b1
   ```

   Use any long random string for `READPAPER_AUTH_SECRET`.

4. Apply the migration:

   ```powershell
   npx wrangler d1 migrations apply readpaper-db --remote
   ```

5. Deploy:

   ```powershell
   npx wrangler deploy
   ```

6. Copy the deployed Worker URL into `readpaper/api-config.js`.

## Local Notes

This repository does not commit `node_modules` or `.wrangler`. Install/use Wrangler with `npx` from a machine that has Node.js available.
