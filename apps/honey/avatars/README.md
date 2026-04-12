# Honey Avatar Pack

Put avatar images in this folder (or subfolders), then edit `manifest.json`.

Example:

```json
{
  "hostMale": [
    "male/host_01.jpg",
    "male/host_02.png"
  ],
  "male": [
    "male/user_01.jpg"
  ],
  "female": [
    "female/user_01.jpg"
  ],
  "audience": [
    "audience/a_01.jpg",
    "audience/a_02.jpg"
  ],
  "all": [
    "misc/m_01.webp"
  ]
}
```

Rules:

- `hostMale`: main host avatar pool (male only, preferred).
- `audience`: right-side audience avatar pool (preferred).
- If `audience` is empty, it falls back to `all + male + female`.
- Paths are relative to this folder.
- Absolute URLs and root paths (for example `/backgrounds/x.jpg`) are also supported.
