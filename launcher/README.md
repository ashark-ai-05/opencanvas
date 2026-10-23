# @ashark/opencanvas (launcher)

```bash
npx @ashark/opencanvas
```

This installs [OpenCanvas](https://github.com/ashark-ai-05/opencanvas) into `~/.opencanvas/app` on first run and then starts it on http://127.0.0.1:3457. You need Node 24+ and git. pnpm comes through corepack, so nothing is installed globally.

- `npx @ashark/opencanvas --update` pulls the latest version (fast-forward only), reinstalls and rebuilds.
- `npx @ashark/opencanvas --dir ./somewhere` installs somewhere else.
- `npx @ashark/opencanvas --dry-run` prints the commands without running them.
