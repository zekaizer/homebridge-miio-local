import type { CharacteristicValue, HAP, PlatformAccessory, Service } from 'homebridge';

import { type DeviceInfo, showInfo } from './accessory-info';
import type { Fan, FanSnapshot } from './fan';
import type { Direction } from './models';

export interface FanAccessoryOptions {
  name: string;
  /** Adds the Move Left and Move Right switches. */
  moveSwitches: boolean;
  info: DeviceInfo;
}

const MOVES: Array<[Direction, string]> = [
  ['left', 'Move Left'],
  ['right', 'Move Right'],
];

// Shows one fan as one HomeKit accessory: a Fanv2 service and, when asked for, two switches that
// turn the head while they are on.
export class FanAccessory {
  private readonly service: Service;
  private readonly switches = new Map<Direction, Service>();
  /** The power and the speed of the write request being handed over. */
  private asked?: { on?: boolean; speed?: number };

  constructor(
    private readonly hap: HAP,
    accessory: PlatformAccessory,
    private readonly fan: Fan,
    options: FanAccessoryOptions,
  ) {
    const { Service: S, Characteristic: C } = hap;

    showInfo(hap, accessory, options.info);

    this.service = accessory.getService(S.Fanv2) ?? accessory.addService(S.Fanv2, options.name);
    this.service.setPrimaryService(true);
    this.service
      .getCharacteristic(C.Active)
      .onGet(() => {
        const { online, state } = this.fan.snapshot;
        if (online === false) {
          throw new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
        return state?.power ? C.Active.ACTIVE : C.Active.INACTIVE;
      })
      .onSet((value) => this.ask({ on: value === C.Active.ACTIVE }));
    this.service
      .getCharacteristic(C.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onSet((value) => this.ask({ speed: value as number }));
    this.service
      .getCharacteristic(C.SwingMode)
      .onSet((value) => this.fan.setOscillation(value === C.SwingMode.SWING_ENABLED));
    this.service
      .getCharacteristic(C.LockPhysicalControls)
      .onSet((value) => this.fan.setLock(value === C.LockPhysicalControls.CONTROL_LOCK_ENABLED));

    for (const [direction, name] of MOVES) {
      const subtype = `move-${direction}`;
      const existing = accessory.getServiceById(S.Switch, subtype);
      if (!options.moveSwitches) {
        if (existing) {
          accessory.removeService(existing);
        }
        continue;
      }
      const service = existing ?? accessory.addService(S.Switch, name, subtype);
      // The Home app shows the services of one accessory by this name, not by Name. Added once:
      // what is added is kept with the accessory.
      if (!service.testCharacteristic(C.ConfiguredName)) {
        service.addCharacteristic(C.ConfiguredName);
      }
      service.setCharacteristic(C.ConfiguredName, name);
      service.updateCharacteristic(C.On, false);
      service.getCharacteristic(C.On).onSet((value) => {
        if (value) {
          this.fan.startJog(direction);
        } else {
          this.fan.stopJog(direction);
        }
      });
      this.switches.set(direction, service);
    }

    fan.onChange((snapshot) => this.show(snapshot));
    this.show(fan.snapshot);
  }

  // The power and the speed of one write request are decided on together, in either order: a
  // request that turns the fan off can carry a speed, and alone that speed would turn the fan on.
  // hap-nodejs hands over every value of a request in one turn of the event loop.
  private ask(change: { on?: boolean; speed?: number }): void {
    if (!this.asked) {
      this.asked = {};
      setImmediate(() => this.decide());
    }
    Object.assign(this.asked, change);
  }

  private decide(): void {
    const { on, speed } = this.asked ?? {};
    this.asked = undefined;
    const power = this.fan.snapshot.state?.power;
    if (on === false || (on === undefined && speed === 0)) {
      if (power !== false) {
        this.fan.setPower(false);
      }
    } else if (speed) {
      this.fan.setLevel(speed);
    } else if (power !== true) {
      this.fan.setPower(true);
    }
    // HomeKit holds the speed it wrote. Without a write to the fan nothing puts back the real one.
    this.show(this.fan.snapshot);
  }

  private show({ online, state, jog }: FanSnapshot): void {
    const { Characteristic: C, HapStatusError, HAPStatus } = this.hap;
    for (const [direction, service] of this.switches) {
      service.updateCharacteristic(C.On, jog === direction);
    }
    if (online === false) {
      this.service.updateCharacteristic(
        C.Active,
        new HapStatusError(
          HAPStatus.SERVICE_COMMUNICATION_FAILURE,
        ) as unknown as CharacteristicValue,
      );
      return;
    }
    if (!state) {
      return;
    }
    this.service
      .updateCharacteristic(C.Active, state.power ? C.Active.ACTIVE : C.Active.INACTIVE)
      .updateCharacteristic(
        C.CurrentFanState,
        state.power ? C.CurrentFanState.BLOWING_AIR : C.CurrentFanState.INACTIVE,
      )
      .updateCharacteristic(C.RotationSpeed, state.level)
      .updateCharacteristic(
        C.SwingMode,
        state.oscillation ? C.SwingMode.SWING_ENABLED : C.SwingMode.SWING_DISABLED,
      )
      .updateCharacteristic(
        C.LockPhysicalControls,
        state.lock
          ? C.LockPhysicalControls.CONTROL_LOCK_ENABLED
          : C.LockPhysicalControls.CONTROL_LOCK_DISABLED,
      );
  }
}
