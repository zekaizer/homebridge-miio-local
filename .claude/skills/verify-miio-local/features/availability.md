# Availability and sync

Home shows what the device actually has: a change made with the remote or on the device appears
within a poll, a device that stops answering is shown as *No Response* and comes back when it
answers, accessories survive a Homebridge restart, and a different model answering at a
configured address replaces the accessory.

## Sub-features

- `sync-remote` a device-side change shows in HAP at the next poll.
- `no-response` a silent device is shown as No Response.
- `recovery` it comes back once it answers again.
- `restart-kept` after a Homebridge restart the same accessories are shown.
- `model-replaced` another model at the address replaces the accessory.

## How to get to it (user POV)

- Home app: a tile changes by itself after someone uses the remote; a tile says No Response
  when the device is unplugged; tiles stay after a Homebridge restart.

## Driving it with ctl.mjs

Preconditions: baseline.

- **Remote change.** `$C $R fake fan-za1 power=off` → `$C $R wait "Fan ZA1" Active 0 8` →
  `ok`. `fake fan-p33 2/6=70` → `wait "Fan P33" "Rotation Speed" 70 8`. Restore with HAP writes.
- **No Response.** `$C $R fake fan-p33 silent=true`, wait 25 s, `$C $R get "Fan P33" Active` →
  `http 207 value undefined hapStatus -70402`. `homebridge.log` has `Fan P33: no reply from the
  fan`, once.
- **Recovery.** `$C $R fake fan-p33 silent=false` → `$C $R wait "Fan P33" Active 1 15` → `ok`.
- **Restart.** Note the `list` output, `$C $R restart` → `http 200`, `doctor` → `OK`, `list`
  shows the same accessories and names; `homebridge.log` shows a second `--- rig: starting
  homebridge`.
- **Another model.** `$C $R fake humidifier model=zhimi.fan.za1`, then `$C $R restart`:
  `homebridge.log` says `Humidifier: zhimi.fan.za1 has taken the place of zhimi.humidifier.ca4`
  and `list Humidifier` shows a fan accessory. Restore with `model=zhimi.humidifier.ca4` and
  restart.
- Run the No Response step on the humidifier too (`silent=true` on `humidifier`).

## Gotchas

- No Response takes about 20-25 s (3 attempts of 6 s), not one poll.
- A device that answers with errors (not silence) is shown as No Response after three failed
  reads in a row; the fake has no switch for that, so that path is covered by unit tests only.
- After `model=` the fake answers with the new model's dialect at once; the accessory changes
  only when the plugin identifies the device again, which happens at startup, hence the restart.
