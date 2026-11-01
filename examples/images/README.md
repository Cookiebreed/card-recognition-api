# Example images

These photos may only be used for testing the NeoSatoshi card recognition API. They are not covered by the MIT license of this repository.

| File | Game | Contents | Recorded response |
|---|---|---|---|
| `example_api_single.jpg` | Pokémon | Cinderace ex, English | [pokemon_single_cinderace.json](../responses/pokemon_single_cinderace.json) |
| `example_api_multi.jpg` | Pokémon | Binder page with 9 cards | none recorded; the API returns every card in `cards` |
| `example_api_jp.jpg` | Pokémon | Japanese card | none recorded |
| `example_api_lorcana.jpg` | Disney Lorcana | Genie, English (`tcg: lorcana`) | [lorcana_en_genie.json](../responses/lorcana_en_genie.json) |
| `example_api_lorcana_de.jpg` | Disney Lorcana | Blume, German (`tcg: lorcana`) | [lorcana_de_blume.json](../responses/lorcana_de_blume.json) |

Photos over 1 MB were downscaled to 1600 px on the long side to keep the repository small.

## TODO

There are no publishable photos for One Piece, Yu-Gi-Oh! and Magic: The Gathering yet. Add one real photo per game here (for example `example_api_onepiece.jpg`, `example_api_yugioh.jpg`, `example_api_magic.jpg`) together with a recorded response in `../responses/`. Until then, the response shape for those games is shown by the catalog-image recordings in [../responses/catalog-shape/](../responses/catalog-shape/).

All example scripts accept any image path, so you can test with your own photos:

```bash
python3 examples/python/detect.py /path/to/your/card.jpg yugioh
```
