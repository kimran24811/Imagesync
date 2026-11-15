SceneSync Sans is an application CSS alias for bundled, subsetted **DejaVu Sans**
Regular and Bold. The SVG exporter uses the same DejaVu font files; no installed
Windows font or network font service is required for these compositions.

The original DejaVu font license and copyright are in LICENSE-DejaVu.txt.
These files retain Latin, Greek, Cyrillic, Hebrew, Arabic, punctuation, currency
symbols and Arabic presentation forms. Additional writing systems require an
appropriate additional font. No character artwork or user media is bundled here.

Reproduction from DejaVu Sans 2.37 using fonttools:

```
pyftsubset DejaVuSans.ttf --unicodes='U+0000-024F,U+0300-052F,U+0590-06FF,U+2000-206F,U+20A0-20CF,U+FB00-FDFF,U+FE70-FEFF' --layout-features='*' --output-file=SceneSyncSans-Regular.ttf
```

Repeat with DejaVuSans-Bold.ttf for the bold file.
