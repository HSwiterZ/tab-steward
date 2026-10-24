# Third-Party Notices

Tab Steward is MIT-licensed (see [LICENSE](./LICENSE)). Parts of it are derived from
third-party open source work, whose own license conditions are reproduced below and
must be preserved in any redistribution.

## Icons — Phosphor (MIT)

`src/ui/icons.js` holds 256×256 duotone icon paths from
[Phosphor](https://github.com/phosphor-icons/core), pulled as Iconify's
`@iconify-json/ph` set. The file header names the source and lists the app-side names
that differ upstream; keep it.

```
MIT License

Copyright (c) 2023 Phosphor Icons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Action icons — Fluent Emoji (MIT)

`assets/emoji/` ships eighteen colour SVGs from Microsoft's
[fluentui-emoji](https://github.com/microsoft/fluentui-emoji) set, pulled as Iconify's
`fluent-emoji` collection. They are the glyphs on the dashboard nav, the popup and
new-tab action rows, the row-level verbs and the sleeping-tab badge; every other
interface glyph remains inline Phosphor path data. The bar-chart file has its
backing plate removed and its viewBox cropped so the tile does not nest one grey
square inside another. `chrome.contextMenus` has no per-item icon field, so the
native right-click menu carries its emoji as plain characters in each item's
title, drawn by the operating system's emoji font rather than these SVGs.

```
MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## UI primitives — shadcn/ui (MIT)

`src/ui/styles/components.css` and the token sheet started from the shadcn/ui
"new-york" conventions. The primitives are hand-authored against this project's own
tokens rather than copied wholesale, but the lineage is acknowledged.
[shadcn/ui](https://github.com/shadcn-ui/ui) is MIT licensed:

```
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Not used

No runtime dependencies. The extension ships no third-party JavaScript, CSS or fonts:
interface icons are inlined SVG path data, top-level action icons are the Fluent Emoji
files above, the type stack is the system font list, and `assets/icon*.png` is generated
from scratch by `tools/make-icons.mjs`.
