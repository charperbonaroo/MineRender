[![Build Status](https://travis-ci.org/InventivetalentDev/MineRender.svg?branch=master)](https://travis-ci.org/InventivetalentDev/MineRender)
[![Documentation Coverage](https://docs.minerender.org/badge.svg)](https://docs.minerender.org)


![MineRender](https://minerender.org/img/minerender-x128.png)

# MineRender
## Quick, Easy, Interactive 3D/2D Renders of Minecraft

For user documentation, see [MineRender.org](https://minerender.org/). For developer documentation, see below.

## Development: Getting started

This is an incomplete guide for setting up a development environment.

Be sure you're running a recent version of NodeJS. The exact version is unspecified. This readme is written with NodeJS 12.13.1. I expect it to work on future versions.

After cloning out this repo:

```sh
npm i
npm run build
```

Then you should start a webserver at root. This webserver should render `index.html`, which uses `<script>` tags to load `dist/*.js`. The easiest way to start a webserver is using `npx http-server`.

Use `npm run build:w` to automatically compile source files on any file change. You'll need to refresh your page to see changes.
