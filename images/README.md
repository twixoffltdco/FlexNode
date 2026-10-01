# Game images

Production needs actual compatible images, for example:

- SAMP Linux server image
- CRMP Linux server image

The Worker intentionally does not bundle proprietary or redistributable game binaries.
Build/use images for which you have the right to distribute and host the server files.

Each server container receives:
- `/server` volume
- selected UDP port
- FLEX_SERVER_ID
- FLEX_SLOTS
- FLEX_PORT
- CPU/RAM/PID limits
