// ============================================================
// InteractionSystem.js — Physical Interaction Coordinator
// ============================================================

import { gameState } from '../core/GameState.js';
import { soundEngine } from '../audio/SoundEngine.js';
import { needsSystem } from '../core/NeedsSystem.js';
import { hardwareSystem } from '../hardware/HardwareSystem.js';

export class InteractionSystem {
  constructor(worldBuilder, playerController) {
    this.worldBuilder = worldBuilder;
    this.playerController = playerController;
    this.bindEvents();
  }

  bindEvents() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE') {
        const s = gameState.get();
        if (s.player.isSitting) return;

        // If carrying package and not hovered on something else, allow opening package
        if (s.player.holding && s.player.holding.type === 'package' && !this.playerController.hoveredObject) {
          hardwareSystem.openPackage();
          this.playerController.updateHeldItemVisual();
          return;
        }

        // If carrying food and not hovering on appliances, eat/drink it
        if (s.player.holding && s.player.holding.type === 'food' && !this.playerController.hoveredObject) {
          const item = s.player.holding.data;
          if (item.needsCooking && !item.cooked) {
            gameState.addNotification('Needs Cooking', 'This food needs to be heated in the microwave first!');
          } else {
            if (item.hunger) needsSystem.eat(item);
            else if (item.thirst) needsSystem.drink(item);
            s.player.holding = null;
            this.playerController.updateHeldItemVisual();
          }
          return;
        }

        this.playerController.interact();
      }
    });

    gameState.on('interactAction', (data) => this.handleAction(data));
  }

  handleAction(data) {
    const s = gameState.get();
    soundEngine.playClick(0.1, 750);

    switch (data.action) {
      case 'use_pc':
        this.playerController.sitAtDesk();
        break;

      case 'light_switch':
        this.worldBuilder.isRoomLightOn = !this.worldBuilder.isRoomLightOn;
        if (this.worldBuilder.roomCeilingLight) {
          this.worldBuilder.roomCeilingLight.intensity = this.worldBuilder.isRoomLightOn ? 1.3 : 0.05;
        }
        soundEngine.playClick(0.2, 550);
        gameState.addNotification('Light Switch', `Room lights ${this.worldBuilder.isRoomLightOn ? 'ON' : 'OFF'}.`);
        break;

      case 'fridge_door':
        const isOpen = this.worldBuilder.toggleFridge();
        if (isOpen) {
          soundEngine.playFridgeOpen();
          this.showFridgeModal();
        } else {
          soundEngine.playClick(0.15, 300);
        }
        break;

      case 'sink_drink':
        soundEngine.playWaterStream(2.0);
        needsSystem.drink({ name: 'Fresh Tap Water', thirst: 35, energy: 5 });
        gameState.modifyNeeds({ hygiene: 15 });
        break;

      case 'microwave':
        if (s.player.holding && s.player.holding.type === 'food') {
          const item = s.player.holding.data;
          soundEngine.playMicrowave();
          item.cooked = true;
          gameState.addNotification('Food Cooked!', `${item.name} is piping hot and ready to eat! Press [E] to eat.`);
        } else {
          gameState.addNotification('Microwave', 'Hold an uncooked food item from the fridge to heat it up.');
        }
        break;

      case 'sleep_bed':
        this.showSleepModal();
        break;

      case 'shower':
        needsSystem.takeShower();
        break;

      case 'package':
        // Pick up package from doorstep
        hardwareSystem.pickUpPackage(data.packageIndex);
        this.worldBuilder.updatePackages();
        this.playerController.updateHeldItemVisual();
        break;

      case 'pc_hardware':
        this.showPCHardwareModal();
        break;

      case 'door_front':
        soundEngine.playDoor(true);
        // Teleport/step outside door or inside
        if (this.playerController.position.z < 5.0) {
          this.playerController.position.set(0, 1.65, 5.8);
          gameState.addNotification('Stepped Outside', 'Stepped out onto Metro City avenue.');
        } else {
          this.playerController.position.set(0, 1.65, 4.2);
          gameState.addNotification('Entered Apartment', 'Welcome home.');
        }
        break;

      case 'wardrobe':
        this.showWardrobeModal();
        break;

      case 'trash':
        if (s.player.holding) {
          s.player.holding = null;
          this.playerController.updateHeldItemVisual();
          soundEngine.playClick(0.15, 400);
          gameState.addNotification('Discarded Item', 'Threw item into the trash can.');
        } else {
          gameState.addNotification('Trash Bin', 'Nothing in hands to discard.');
        }
        break;

      case 'store_freshmart':
        this.showFreshMartModal();
        break;

      case 'store_silicontech':
        this.showSiliconTechModal();
        break;

      case 'store_cafe':
        this.showCafeModal();
        break;

      case 'atm_banking':
        this.showATMModal();
        break;

      case 'talk_npc':
        this.talkToNPC(data.npcName);
        break;
    }
  }

  showFridgeModal() {
    const s = gameState.get();
    const modal = document.createElement('div');
    modal.className = 'game-modal-backdrop';
    modal.innerHTML = `
      <div class="game-modal-card">
        <h3>🧊 REFRIGERATOR</h3>
        <p>Select a snack or drink to carry:</p>
        <div class="fridge-items-list">
          ${s.fridge.map((f, idx) => `
            <div class="fridge-item-row">
              <div>
                <b>${f.name}</b>
                <span>${f.hunger ? `Hunger +${f.hunger}` : ''} ${f.thirst ? `Thirst +${f.thirst}` : ''}</span>
              </div>
              <button class="btn-take-food" data-idx="${idx}">Take</button>
            </div>
          `).join('')}
        </div>
        <button id="btn-close-fridge" class="btn-primary" style="margin-top:15px;">Close Door</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelectorAll('.btn-take-food').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'));
        const item = s.fridge.splice(idx, 1)[0];
        s.player.holding = { type: 'food', data: item };
        this.playerController.updateHeldItemVisual();
        soundEngine.playClick(0.12, 600);
        gameState.addNotification('Took Food', `Holding ${item.name}. ${item.needsCooking ? 'Heat it in microwave or eat.' : 'Press [E] to consume.'}`);
        modal.remove();
        this.worldBuilder.toggleFridge();
      });
    });

    modal.querySelector('#btn-close-fridge').addEventListener('click', () => {
      modal.remove();
      this.worldBuilder.toggleFridge();
    });
  }

  showSleepModal() {
    const modal = document.createElement('div');
    modal.className = 'game-modal-backdrop';
    modal.innerHTML = `
      <div class="game-modal-card">
        <h3>🛏️ SLEEP IN BED</h3>
        <p>Choose sleep duration to recover energy and lower stress:</p>
        <div class="sleep-buttons">
          <button class="btn-sleep-dur" data-h="4">4 Hours (Quick Nap)</button>
          <button class="btn-sleep-dur" data-h="6">6 Hours (Moderate)</button>
          <button class="btn-sleep-dur" data-h="8">8 Hours (Full Rest)</button>
          <button class="btn-sleep-dur" data-h="10">10 Hours (Deep Sleep)</button>
        </div>
        <button id="btn-cancel-sleep" class="btn-secondary" style="margin-top:15px;">Cancel</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelectorAll('.btn-sleep-dur').forEach(b => {
      b.addEventListener('click', () => {
        const hours = parseInt(b.getAttribute('data-h'));
        modal.remove();
        // Show sleep fade overlay
        const fade = document.createElement('div');
        fade.className = 'sleep-fade-overlay';
        document.body.appendChild(fade);

        needsSystem.sleep(hours, () => {
          fade.classList.add('fade-out');
          setTimeout(() => fade.remove(), 800);
        });
      });
    });

    modal.querySelector('#btn-cancel-sleep').addEventListener('click', () => modal.remove());
  }

  showPCHardwareModal() {
    const s = gameState.get();
    const modal = document.createElement('div');
    modal.className = 'game-modal-backdrop';
    modal.innerHTML = `
      <div class="game-modal-card wide">
        <h3>🖥️ PC HARDWARE & UPGRADES</h3>
        <div class="hw-inspector-grid">
          <div class="hw-installed-col">
            <h4>Installed Components</h4>
            <div class="hw-slot"><b>GPU:</b> ${s.pc.hardware.gpu.name} (${s.pc.hardware.gpu.score || 600} pts)</div>
            <div class="hw-slot"><b>CPU:</b> ${s.pc.hardware.cpu.name}</div>
            <div class="hw-slot"><b>RAM:</b> ${s.pc.hardware.ram.name}</div>
            <div class="hw-slot"><b>Cooler:</b> ${s.pc.hardware.cooler.name}</div>
            <div class="hw-slot"><b>Mic:</b> ${s.pc.hardware.mic.name}</div>
            <div class="hw-slot"><b>Webcam:</b> ${s.pc.hardware.webcam.name}</div>
            <div class="hw-bench-score">Benchmark Score: <b>${s.pc.benchmarkScore.toLocaleString()} PTS</b></div>
          </div>
          <div class="hw-inventory-col">
            <h4>Uninstalled Parts in Room</h4>
            ${(!s.inventory || s.inventory.length === 0) ? `
              <p style="color:#94a3b8; font-size:14px;">No uninstalled parts. Order components from NovaMarket on your PC or phone!</p>
            ` : `
              <div class="parts-to-install">
                ${s.inventory.map((item, idx) => `
                  <div class="install-row">
                    <div><b>${item.name}</b> (+${item.score || 500} pts)</div>
                    <button class="btn-install-part" data-idx="${idx}">Install</button>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>
        <button id="btn-close-hw" class="btn-primary" style="margin-top:20px;">Close PC Case</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelectorAll('.btn-install-part').forEach(b => {
      b.addEventListener('click', () => {
        const idx = parseInt(b.getAttribute('data-idx'));
        const item = s.inventory[idx];
        hardwareSystem.installComponent(item);
        modal.remove();
        this.showPCHardwareModal();
      });
    });

    modal.querySelector('#btn-close-hw').addEventListener('click', () => modal.remove());
  }

  showWardrobeModal() {
    const s = gameState.get();
    const modal = document.createElement('div');
    modal.className = 'game-modal-backdrop';
    modal.innerHTML = `
      <div class="game-modal-card">
        <h3>👔 WARDROBE & STYLE</h3>
        <p>Change your outfit and appearance:</p>
        <div class="wardrobe-picker">
          <label>Shirt / Hoodie Color</label>
          <div class="color-options">
            <button class="color-swatch" data-type="shirt" data-color="#2563eb" style="background:#2563eb"></button>
            <button class="color-swatch" data-type="shirt" data-color="#dc2626" style="background:#dc2626"></button>
            <button class="color-swatch" data-type="shirt" data-color="#16a34a" style="background:#16a34a"></button>
            <button class="color-swatch" data-type="shirt" data-color="#9333ea" style="background:#9333ea"></button>
            <button class="color-swatch" data-type="shirt" data-color="#18181b" style="background:#18181b"></button>
          </div>
          <label style="margin-top:10px;">Pants Color</label>
          <div class="color-options">
            <button class="color-swatch" data-type="pants" data-color="#1e293b" style="background:#1e293b"></button>
            <button class="color-swatch" data-type="pants" data-color="#3b82f6" style="background:#3b82f6"></button>
            <button class="color-swatch" data-type="pants" data-color="#78350f" style="background:#78350f"></button>
          </div>
        </div>
        <button id="btn-close-wardrobe" class="btn-primary" style="margin-top:20px;">Save Style</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelectorAll('.color-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        const type = sw.getAttribute('data-type');
        const color = sw.getAttribute('data-color');
        if (type === 'shirt') {
          s.player.outfit.shirtColor = color;
          if (this.playerController.torsoMesh) this.playerController.torsoMesh.material.color.set(color);
        } else if (type === 'pants') {
          s.player.outfit.pantsColor = color;
          if (this.playerController.leftLegMesh) this.playerController.leftLegMesh.material.color.set(color);
          if (this.playerController.rightLegMesh) this.playerController.rightLegMesh.material.color.set(color);
        }
        soundEngine.playClick(0.12, 650);
      });
    });

    modal.querySelector('#btn-close-wardrobe').addEventListener('click', () => modal.remove());
  }

  showFreshMartModal() {
    const s = gameState.get();
    const items = [
      { name: 'Fresh Apple & Fruit', hunger: 25, thirst: 15, price: 4.50 },
      { name: 'Club Deli Sandwich', hunger: 45, thirst: -5, price: 6.50 },
      { name: 'Instant Noodle 6-Pack', hunger: 50, thirst: -10, price: 8.00, needsCooking: true },
      { name: 'Volt Surge 4-Pack', thirst: 50, energy: 35, price: 9.00 }
    ];

    const modal = document.createElement('div');
    modal.className = 'game-modal-backdrop';
    modal.innerHTML = `
      <div class="game-modal-card">
        <h3>🛒 FRESHMART 24/7</h3>
        <p>Cash on hand: <b>$${s.player.cash.toFixed(2)}</b></p>
        <div class="market-list">
          ${items.map((it, idx) => `
            <div class="market-row">
              <div><b>${it.name}</b> <span>$${it.price.toFixed(2)}</span></div>
              <button class="btn-buy-food" data-idx="${idx}">Buy</button>
            </div>
          `).join('')}
        </div>
        <button id="btn-close-market" class="btn-secondary" style="margin-top:15px;">Leave Store</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelectorAll('.btn-buy-food').forEach(b => {
      b.addEventListener('click', () => {
        const idx = parseInt(b.getAttribute('data-idx'));
        const it = items[idx];
        if (s.player.cash >= it.price) {
          gameState.addCash(-it.price, `FreshMart: ${it.name}`);
          s.fridge.push({ ...it, id: 'item_' + Date.now() });
          soundEngine.playCashRegister();
          gameState.addNotification('Purchased Groceries', `Bought ${it.name}. Stocked into apartment fridge.`);
          modal.remove();
          this.showFreshMartModal();
        } else {
          gameState.addNotification('Not Enough Cash', 'You do not have enough cash in your pocket. Visit the ATM!');
        }
      });
    });

    modal.querySelector('#btn-close-market').addEventListener('click', () => modal.remove());
  }

  showSiliconTechModal() {
    const s = gameState.get();
    const modal = document.createElement('div');
    modal.className = 'game-modal-backdrop';
    modal.innerHTML = `
      <div class="game-modal-card wide">
        <h3>⚡ SILICONTECH HARDWARE RETAIL</h3>
        <p>Buy parts in person. Bank balance: <b>$${s.player.bank.toFixed(2)}</b></p>
        <div class="silicon-list">
          <div class="silicon-row">
            <div><b>GeForce RTX Nova 3060 12GB</b> — Instant pickup</div>
            <button class="btn-buy-direct" data-id="gpu_rtx3060">$320.00</button>
          </div>
          <div class="silicon-row">
            <div><b>Apex Studio Microphone Pro</b> — Crystal clear audio</div>
            <button class="btn-buy-direct" data-id="gear_mic_pro">$95.00</button>
          </div>
        </div>
        <button id="btn-close-silicon" class="btn-secondary" style="margin-top:15px;">Leave Store</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelectorAll('.btn-buy-direct').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-id');
        const item = (id === 'gpu_rtx3060') ?
          { id: 'gpu_rtx3060', type: 'gpu', name: 'RTX Nova 3060 12GB', price: 320.00, score: 1800, maxRes: '1080p 60fps' } :
          { id: 'gear_mic_pro', type: 'mic', name: 'Apex Studio Microphone Pro', price: 95.00, quality: 'Studio Grade' };

        if (s.player.bank >= item.price) {
          gameState.addBank(-item.price, `SiliconTech Store: ${item.name}`);
          if (!s.inventory) s.inventory = [];
          s.inventory.push(item);
          soundEngine.playCashRegister();
          gameState.addNotification('Hardware Purchased!', `Bought ${item.name}! Go to your PC case in your apartment to install it.`);
          modal.remove();
        } else {
          gameState.addNotification('Declined', 'Insufficient bank funds.');
        }
      });
    });

    modal.querySelector('#btn-close-silicon').addEventListener('click', () => modal.remove());
  }

  showCafeModal() {
    const s = gameState.get();
    const modal = document.createElement('div');
    modal.className = 'game-modal-backdrop';
    modal.innerHTML = `
      <div class="game-modal-card">
        <h3>☕ PULSE CAFE</h3>
        <p>A trendy cafe where creators and gamers hang out.</p>
        <div class="cafe-actions">
          <button id="btn-buy-coffee" class="cafe-action-btn">
            <b>Buy Gourmet Espresso ($5.00)</b>
            <span>Restores energy +30, reduces stress</span>
          </button>
          <button id="btn-cafe-shift" class="cafe-action-btn highlight">
            <b>Work 2-Hour Barista Shift</b>
            <span>Earn +$45.00 cash immediately</span>
          </button>
        </div>
        <button id="btn-close-cafe" class="btn-secondary" style="margin-top:15px;">Exit Cafe</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#btn-buy-coffee').addEventListener('click', () => {
      if (s.player.cash >= 5.0) {
        gameState.addCash(-5.0, 'Pulse Cafe Coffee');
        needsSystem.drink({ name: 'Gourmet Espresso', thirst: 20, energy: 35 });
        modal.remove();
      } else {
        gameState.addNotification('No Cash', 'You need $5.00 cash.');
      }
    });

    modal.querySelector('#btn-cafe-shift').addEventListener('click', () => {
      soundEngine.playCashRegister();
      gameState.addCash(45.0, 'Barista Shift Wages');
      gameState.modifyNeeds({ energy: -20, hunger: -15, thirst: -15 });
      s.gameTime.hour = (s.gameTime.hour + 2) % 24;
      gameState.addNotification('Shift Finished!', 'Worked 2 hours at Pulse Cafe. Earned $45.00 cash!');
      modal.remove();
    });

    modal.querySelector('#btn-close-cafe').addEventListener('click', () => modal.remove());
  }

  showATMModal() {
    const s = gameState.get();
    const modal = document.createElement('div');
    modal.className = 'game-modal-backdrop';
    modal.innerHTML = `
      <div class="game-modal-card">
        <h3>🏧 METROVAULT ATM</h3>
        <p>Bank Balance: <b>$${s.player.bank.toFixed(2)}</b> | Cash on Hand: <b>$${s.player.cash.toFixed(2)}</b></p>
        <div class="atm-grid">
          <button id="btn-atm-dep50" class="btn-primary">Deposit $50 Cash</button>
          <button id="btn-atm-with50" class="btn-secondary">Withdraw $50 Cash</button>
          <button id="btn-atm-depall" class="btn-primary">Deposit All Cash</button>
        </div>
        <button id="btn-close-atm" class="btn-secondary" style="margin-top:15px;">Exit ATM</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#btn-atm-dep50').addEventListener('click', () => {
      if (s.player.cash >= 50) {
        gameState.addCash(-50, 'ATM Deposit');
        gameState.addBank(50, 'ATM Cash Deposit');
        soundEngine.playCashRegister();
        modal.remove();
        this.showATMModal();
      } else {
        gameState.addNotification('ATM', 'You do not have $50 cash.');
      }
    });

    modal.querySelector('#btn-atm-with50').addEventListener('click', () => {
      if (s.player.bank >= 50) {
        gameState.addBank(-50, 'ATM Withdrawal');
        gameState.addCash(50, 'ATM Cash Withdrawn');
        soundEngine.playCashRegister();
        modal.remove();
        this.showATMModal();
      } else {
        gameState.addNotification('ATM', 'Insufficient bank funds.');
      }
    });

    modal.querySelector('#btn-atm-depall').addEventListener('click', () => {
      const all = Math.floor(s.player.cash);
      if (all > 0) {
        gameState.addCash(-all, 'ATM Deposit');
        gameState.addBank(all, 'ATM Cash Deposit');
        soundEngine.playCashRegister();
        modal.remove();
        this.showATMModal();
      }
    });

    modal.querySelector('#btn-close-atm').addEventListener('click', () => modal.remove());
  }

  talkToNPC(name) {
    const dialogues = [
      'Hey! Heard you just started streaming. Consistency is key!',
      'Did you see the new Velocity Rush tournament announcement? Prize pool is huge!',
      'Make sure you keep your stream bitrate stable, viewers hate buffer lag.',
      'Pulse Cafe has great coffee if you need an energy boost before a stream!'
    ];
    const line = dialogues[Math.floor(Math.random() * dialogues.length)];
    soundEngine.playClick(0.1, 800);
    gameState.addNotification(`${name}`, `"${line}"`);
  }
}
