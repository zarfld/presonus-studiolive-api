PreSonus StudioLive III API
---

An unofficial API for the PreSonus StudioLive III consoles.

Tested against the following models

* StudioLive 16 Mixer
* StudioLive 16R Rack Mixer
* StudioLive 24R Rack Mixer

---

# Install

`npm install featherbear/presonus-studiolive-api#v1.7.2`

# Usage

[Refer to the documentation](https://featherbear.cc/presonus-studiolive-api)

---

## License

Copyright © 2019 - 2025 Andrew Wong  

This software is licensed under the [MIT License](https://opensource.org/licenses/MIT).  
You are free to redistribute it and/or modify it under the [terms](https://opensource.org/licenses/MIT) of the [license](https://opensource.org/licenses/MIT).

---

Live Tests & Environment Flags
---

These integration tests talk to a real StudioLive console discovered over the network. No hardcoded IPs are used; discovery selects the first device by default.

* `TEST_LOG`: Enable verbose test logs for discovery/connection paths.
	* `1` or `true` to enable.
* `PRESONUS_HANDSHAKE_TIMEOUT_MS`: Handshake fast-fail timeout in milliseconds.
	* Default: `10000` (overridden to `12000` in tests if unset).
* `ALLOW_MUTATIONS`: Enable revert-safe mutation tests (default runs are non-destructive).
	* `1` or `true` to enable.
* `PRESONUS_NAME`: Optional device name substring filter for discovery.
* `PRESONUS_SERIAL`: Optional exact serial filter for discovery.
* `MIXER_PORT`: Override TCP control port (default `53000`).

Examples (PowerShell):

```powershell
# Read-only suites (meters, discovery lifecycle)
Push-Location "D:\Repos\presonus-studiolive-api-c-\reference-api"
Set-Item Env:TEST_LOG '1'
npm run test:jest -- tests/integration/live.meters.spec.ts tests/integration/live.lifecycle.spec.ts
Pop-Location

# Enable revert-safe mutation suite
Push-Location "D:\Repos\presonus-studiolive-api-c-\reference-api"
Set-Item Env:ALLOW_MUTATIONS '1'
Set-Item Env:TEST_LOG '1'
npm run test:jest -- tests/integration/live.mutations.spec.ts
Remove-Item Env:ALLOW_MUTATIONS; Remove-Item Env:TEST_LOG
Pop-Location
```

Notes:

* Mutation tests always revert any change. They are opt-in via `ALLOW_MUTATIONS`.
* If no mixer is discovered, tests log a no-op and exit gracefully.
