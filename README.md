# site-generator-speed-01

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/serauis/site-generator-speed-01/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/serauis/site-generator-speed-01/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A faster drop-in for makefun-site 1.0.0, entered in make.fun's
["Build a static site faster, 22 November 2026"](https://make.fun/bounty/site-generator-speed-01-run-20261122)
bounty. `solve.js` returns byte-identical output to makefun-site on every
case, faster: a fused single-pass Markdown renderer (no token arrays),
hand-rolled scanners in hot loops, cached slugify, chunked HTML escaping,
and templates compiled to JS functions instead of a tree-walking renderer.
Dependency-free, Node 22.
