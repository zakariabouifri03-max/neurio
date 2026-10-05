// ============================================================
// HardwareSystem.js — PC Components, Ordering & Assembly
// ============================================================

import { gameState } from '../core/GameState.js';
import { soundEngine } from '../audio/SoundEngine.js';

export const HARDWARE_CATALOG = [
  // GPUs
  { id: 'gpu_rtx3060', type: 'gpu', name: 'RTX Nova 3060 12GB', price: 320.00, score: 1800, maxRes: '1080p 60fps', desc: 'Capable mid-tier GPU. Unlocks silky smooth 1080p 60fps streaming.' },
  { id: 'gpu_rtx4080', type: 'gpu', name: 'RTX Nova 4080 Extreme', price: 850.00, score: 3800, maxRes: '4K 60fps', desc: 'Flagship graphics powerhouse with triple RGB fans. Flawless 4K broadcast.' },

  // CPUs
  { id: 'cpu_i5', type: 'cpu', name: 'HexaCore i5 Pro 4.6GHz', price: 180.00, score: 1400, desc: '6-core processor. Prevents dropped frames and encoding stutter.' },
  { id: 'cpu_ultra9', type: 'cpu', name: 'OctaCore Ultra 9 5.4GHz', price: 390.00, score: 2600, desc: 'High-end flagship CPU. Multitask, stream, and game simultaneously with zero lag.' },

  // RAM
  { id: 'ram_16gb', type: 'ram', name: '16GB DDR4 Dual Channel', price: 75.00, score: 850, desc: 'Smooth multitasking memory upgrade.' },
  { id: 'ram_32gb', type: 'ram', name: '32GB RGB DDR5 6000MHz', price: 150.00, score: 1400, desc: 'Ultra-fast DDR5 with customizable RGB sync.' },

  // Coolers
  { id: 'cooler_tower', type: 'cooler', name: 'HyperTower 120 Air Cooler', price: 55.00, score: 650, desc: 'Quiet copper heatpipe tower. Lowers CPU temps.' },
  { id: 'cooler_liquid', type: 'cooler', name: 'LiquidCool 360 RGB AIO', price: 130.00, score: 1100, desc: 'Triple-fan liquid cooling loop with illuminated pump.' },

  // Streaming Gear
  { id: 'gear_mic_pro', type: 'mic', name: 'Apex Broadcast Studio Mic', price: 95.00, quality: 'Studio Grade', desc: 'Cardioid XLR-style microphone with shockmount. Pristine voice clarity.' },
  { id: 'gear_cam_4k', type: 'webcam', name: '4K UltraCam Streamer Pro', price: 130.00, quality: '4K 60FPS', desc: 'Crisp autofocus webcam with ring light. Viewers will praise your video quality.' }
];

export class HardwareSystem {
  orderComponent(item) {
    const s = gameState.get();
    if (s.player.bank < item.price) {
      soundEngine.playClick(0.2, 200);
      gameState.addNotification('Payment Declined', `Insufficient funds in MetroVault account for ${item.name} ($${item.price.toFixed(2)}).`);
      return false;
    }

    gameState.addBank(-item.price, `NovaMarket Order: ${item.name}`);
    soundEngine.playCashRegister();

    gameState.addNotification('Order Confirmed!', `Ordered ${item.name}. Priority shipping scheduled.`);

    // Delivery pipeline: 10 seconds delivery delay
    setTimeout(() => {
      this.deliverPackage(item);
    }, 10000);

    return true;
  }

  deliverPackage(item) {
    const s = gameState.get();
    const pkg = {
      id: 'pkg_' + Date.now(),
      sender: 'NOVAMARKET',
      item,
      location: 'doorstep'
    };
    s.packages.push(pkg);

    // Door knock sound & notification
    soundEngine.playDoor(false);
    setTimeout(() => soundEngine.playNotification(), 300);

    gameState.addNotification(
      '📦 Package Delivered!',
      `A delivery courier just left your package at your front door (${item.name}).`
    );
    gameState.emit('packageDelivered', pkg);
  }

  pickUpPackage(packageIndex) {
    const s = gameState.get();
    if (packageIndex >= 0 && packageIndex < s.packages.length) {
      const pkg = s.packages.splice(packageIndex, 1)[0];
      s.player.holding = {
        type: 'package',
        data: pkg
      };
      soundEngine.playClick(0.15, 500);
      gameState.addNotification('Carrying Package', `Carrying ${pkg.item.name}. Open it or take it to your desk.`);
      gameState.emit('holdingChanged', s.player.holding);
      return true;
    }
    return false;
  }

  openPackage() {
    const s = gameState.get();
    if (!s.player.holding || s.player.holding.type !== 'package') return null;

    const pkg = s.player.holding.data;
    const item = pkg.item;
    s.player.holding = null;

    soundEngine.playClick(0.2, 700); // Box tape rip

    // Put item into uninstalled inventory
    if (!s.inventory) s.inventory = [];
    s.inventory.push(item);

    gameState.addNotification('Unboxed Item!', `Unboxed ${item.name}! Ready to install in PC Case.`);
    gameState.emit('holdingChanged', null);
    gameState.emit('inventoryChanged', s.inventory);
    return item;
  }

  installComponent(item) {
    const s = gameState.get();
    soundEngine.playClick(0.25, 800); // Hardware snap/click

    if (item.type === 'gpu') {
      s.pc.hardware.gpu = item;
    } else if (item.type === 'cpu') {
      s.pc.hardware.cpu = item;
    } else if (item.type === 'ram') {
      s.pc.hardware.ram = item;
    } else if (item.type === 'cooler') {
      s.pc.hardware.cooler = item;
    } else if (item.type === 'mic') {
      s.pc.hardware.mic = item;
    } else if (item.type === 'webcam') {
      s.pc.hardware.webcam = item;
    }

    // Remove from uninstalled inventory
    if (s.inventory) {
      const idx = s.inventory.findIndex(x => x.id === item.id);
      if (idx !== -1) s.inventory.splice(idx, 1);
    }

    const newScore = gameState.recalculateBenchmark();
    gameState.addNotification(
      'Hardware Installed!',
      `Successfully installed ${item.name}! New PC Benchmark Score: ${newScore.toLocaleString()} PTS!`
    );
    gameState.emit('hardwareInstalled', item);
  }
}

export const hardwareSystem = new HardwareSystem();
