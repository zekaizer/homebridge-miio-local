# Move switches

With `moveSwitches` on, a fan gets two extra switches, *Move Left* and *Move Right*. While one is
on, the head turns one step every 0.75 s; turning it off stops the head after the step already
sent. A switch left on turns itself off after enough steps to cross the whole range, and turning
one on turns the other off.

## Sub-features

- `move-start-stop` turning a switch on sends steps; turning it off stops them.
- `move-auto-off` a switch left on turns itself off after about 18-22 s.
- `move-exclusive` turning one switch on turns the other off.
- `move-oscillation-off` a move turns oscillation off first.
- `move-config-off` without `moveSwitches` the switches are absent.

## How to get to it (user POV)

- Home app: the fan accessory shows two switch tiles (or grouped controls) named Move Left and
  Move Right.

## Driving it with ctl.mjs

Preconditions: baseline; the fan is on (`get "Fan ZA1" Active` → `1`) and oscillation off.

- **Start.** `$C $R set "Fan ZA1/Move Left" On 1` → `http 204`. After 2 s, `$C $R fake
  fan-za1` → `moves` grows with `"left"` entries and requests `set_move ["left"]`.
- **Stop.** `$C $R set "Fan ZA1/Move Left" On 0`; read `fake` twice 2 s apart: `moves` stops
  growing (at most one more step). `get "Fan ZA1/Move Left" On` → `0`.
- **Exclusive.** Turn Move Left on, then `set "Fan ZA1/Move Right" On 1`: `get "Fan ZA1/Move
  Left" On` → `0`, new `moves` entries are `"right"`.
- **Auto off.** Turn one on and `$C $R wait "Fan ZA1/Move Right" On 0 30` → `ok` within ~22 s.
- **Oscillation off.** `set "Fan ZA1" "Swing Mode" 1`, then turn a move switch on: `get "Fan
  ZA1" "Swing Mode"` → `0`, `fake` → `angle_enable: "off"` before the first `set_move`.
- **Config off.** Edit `hb/config.json` to set `moveSwitches: false` on `Fan ZA1`, `restart`;
  `$C $R list "Fan ZA1"` shows no `Move Left`/`Move Right` services. Restore and restart.
- Repeat on `Fan P33`: its steps show as `moves` entries too, from `set_properties` on `"6/1"`.

## Gotchas

- With the fan off, `fan-za1` refuses moves (`-6011`): the switch reads back `0` and `moves`
  stays empty. Make sure the fan is on before driving this.
- `fan-za1` refuses moves while oscillating (`-6007`); the plugin turns oscillation off first,
  which is what `move-oscillation-off` proves.
- Auto-off timing is in steps, not seconds; expect anything in roughly 18-22 s.
