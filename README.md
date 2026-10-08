# Changing Room

A 3D dress-up viewer. A faceless figure wears garments that are built as real geometry from flat product photos.

**Live demo:** https://kaiotei.github.io/1333-changing-room/

Built by [Kaiotei](https://github.com/Kaiotei) for [13 <33 Covenant](https://1333covenant.com) and released as one of its open-source apps.

## Features

- Garments are generated meshes (tees, crops, tanks, hoodies, jerseys, dresses, pants, button-ups), not photos on planes.
- The print is lifted off a flat-lay product photo and projected onto the garment.
- Hats, shoes and bags load optional `.glb` models and fall back to procedural stand-ins.
- Sizes and colourways per product, full outfits across slots.

## Run it

```sh
python -m http.server 8000
# then open http://localhost:8000/
```
It uses ES modules, so it has to be served; opening the file directly will not work.

## Make it yours

- **`wardrobe.js`** is the catalogue: `window.WARDROBE` (one record per product: `id`, `name`, `slot`, `type`, `img`, `gallery`, `price`) and `window.SHOP_MAPS` (colours and sizes per design). The demo holds 13 pieces from the 13 <33 Covenant shop, loaded from 1333covenant.com.
- **`cr/models.js`** sets `MODEL_DIR`, where optional prop models are read from. The demo points it at the originals on 1333covenant.com.
- **`cr/specs.js`** maps product names to garment types; hand-tuned fit goes in `SPEC_OVERRIDES`.
- **Shop hooks:** the Add to cart / Card / Crypto buttons are hidden in this demo. To use them, remove the `<style>` line that hides them in `index.html`, give records `card` / `crypto` URLs, and expose `window.Cart.addItem({ name, price, size, color, image })`.

Product photos and models are not in this repo; the demo reads them from the live site.

**Stack:** three.js r185, vanilla JS modules, no build step.

## License

[AGPL-3.0](LICENSE). You can use, change and build on this. If you run a modified version for others over a network, you must share its source under the same license. Keep the credit to 13 <33 Covenant.

## More from 13 <33 Covenant

[1333-island-world](https://github.com/Kaiotei/1333-island-world) · [1333-whole-armor](https://github.com/Kaiotei/1333-whole-armor) · [1333-globe](https://github.com/Kaiotei/1333-globe) · [1333-jacobs-ladder](https://github.com/Kaiotei/1333-jacobs-ladder) · [1333-angelhub](https://github.com/Kaiotei/1333-angelhub) · [1333-bible-study](https://github.com/Kaiotei/1333-bible-study) · [1333-moon-calendar](https://github.com/Kaiotei/1333-moon-calendar) · [1333-guestbook](https://github.com/Kaiotei/1333-guestbook) · [1333-chat-widget](https://github.com/Kaiotei/1333-chat-widget) · [1333-contrast-check](https://github.com/Kaiotei/1333-contrast-check)
