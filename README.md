# Studio (private pictures + 60-second videos)

Password-protected site. Pictures and videos are made through Replicate. No Claude, no npm packages.

## Setup
1. Make an account at replicate.com, add billing credit, create an API token (replicate.com/account/api-tokens).
2. Upload these files to a host that runs Docker (Render, Railway, Fly.io). Use the Dockerfile so ffmpeg is installed (needed for the "Join into one video file" button).
3. Set environment variables:
   - REPLICATE_API_TOKEN = your token
   - SITE_PASSWORD = a strong password
   - SESSION_SECRET = any long random string (optional)
   - IMAGE_MODEL (optional, default black-forest-labs/flux-schnell)
   - VIDEO_MODEL (optional, default bytedance/seedance-2.0)
4. Open the HTTPS link and sign in.

## Local test
REPLICATE_API_TOKEN=r8_... SITE_PASSWORD=secret node server.js  ->  http://localhost:3000

## How the 60 seconds works
Video models make clips of about 15 seconds at most. The site makes 4 clips of 15 seconds, plays them back to back, and can join them into one file.
If you swap VIDEO_MODEL, the new model must accept prompt, duration, aspect_ratio, resolution and generate_audio inputs (edit server.js otherwise).
