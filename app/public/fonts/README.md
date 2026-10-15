`inter-arrows.woff2` is a subset of [Inter](https://github.com/rsms/inter) (© 2016 The Inter Project Authors) that holds only the Arrows block, U+2190–21FF. It's licensed under the SIL Open Font License 1.1: https://openfontlicense.org.

Why it exists: the Google Fonts `latin` subset of Inter and Geist leaves out `→` (U+2192), so card titles like "12 km → mi" fell back to a thin system font and the arrow vanished at small sizes and in recordings.

Regenerate it with:

    pyftsubset Inter-VariableFont_opsz,wght.ttf --unicodes="U+2190-21FF" --flavor=woff2 --layout-features='*' --output-file=inter-arrows.woff2
