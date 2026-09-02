# Honey Avatar Pack

Put avatar images in this folder (or subfolders), then edit `manifest.json`.

Example:

```json
{
  "hostMale": [
    "male/host_01.jpg",
    "male/host_02.png"
  ],
  "hostFemale": [
    "female/host_01.jpg",
    "female/host_02.png"
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

- `hostMale` / `hostFemale`: gender-specific host avatar pools.
- `male` / `female`: gender-specific audience pools and host fallbacks.
- `audience`: legacy default audience pool when no gender preference is supplied.
- A preferred gender pool is used first; `audience`, the other gender, and `all` only fill missing slots.
- Paths are relative to this folder.
- Absolute URLs and root paths (for example `/backgrounds/x.jpg`) are also supported.
