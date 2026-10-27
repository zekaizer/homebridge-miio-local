import type { HAP, PlatformAccessory, Service } from 'homebridge';

export interface DeviceInfo {
  model: string;
  firmware?: string;
  serial?: string;
}

export function showInfo(hap: HAP, accessory: PlatformAccessory, info: DeviceInfo): void {
  const { Service: S, Characteristic: C } = hap;
  const service = accessory.getService(S.AccessoryInformation) as Service;
  service.setCharacteristic(C.Manufacturer, 'Xiaomi').setCharacteristic(C.Model, info.model);
  if (info.serial) {
    service.setCharacteristic(C.SerialNumber, info.serial);
  }
  if (info.firmware) {
    service.setCharacteristic(C.FirmwareRevision, info.firmware);
  }
}
