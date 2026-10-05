// ============================================================
// main.js — Game Lifecycle & Architecture Coordinator
// ============================================================

import * as THREE from 'three';
import { gameState } from './core/GameState.js';
import { soundEngine } from './audio/SoundEngine.js';
import { timeWeatherSystem } from './core/TimeWeatherSystem.js';
import { needsSystem } from './core/NeedsSystem.js';
import { economySystem } from './core/EconomySystem.js';
import { streamEngine } from './streaming/StreamEngine.js';
import { WorldBuilder } from './world/WorldBuilder.js';
import { PlayerController } from './player/PlayerController.js';
import { InteractionSystem } from './interactions/InteractionSystem.js';
import { SmartPhone } from './phone/SmartPhone.js';
import { NovaOS } from './pc/NovaOS.js';
import { UIOverlay } from './ui/UIOverlay.js';

class GameApp {
  constructor() {
    this.container = document.getElementById('app');
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.clock = new THREE.Clock();

    // Subsystems
    this.worldBuilder = null;
    this.playerController = null;
    this.interactionSystem = null;
    this.smartPhone = null;
    this.novaOS = null;
    this.uiOverlay = null;

    this.init();
  }

  init() {
    // 1. Initialize State & Audio
    gameState.init();
    soundEngine.init();

    // 2. Initialize Three.js Scene, Camera, Renderer
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x090d16);
    this.scene.fog = new THREE.FogExp2(0x090d16, 0.025);

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(72, aspect, 0.1, 120);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.container.appendChild(this.renderer.domElement);

    // 3. Build 3D World (Apartment, Setup, City)
    this.worldBuilder = new WorldBuilder(this.scene);
    this.worldBuilder.buildAll();

    // 4. Initialize Player Controller & Full Body
    this.playerController = new PlayerController(this.camera, this.renderer.domElement, this.worldBuilder);

    // 5. Initialize Interactions System
    this.interactionSystem = new InteractionSystem(this.worldBuilder, this.playerController);

    // 6. Initialize UI Overlay (HUD, Reticle, Needs)
    this.uiOverlay = new UIOverlay();

    // 7. Initialize Smartphone UI
    this.smartPhone = new SmartPhone();

    // 8. Initialize Desktop Nova OS
    this.novaOS = new NovaOS(this.playerController);

    // 9. Window Resize Event
    window.addEventListener('resize', () => this.onResize());

    // 10. Hide loading splash if present
    const loader = document.getElementById('loading');
    if (loader) {
      setTimeout(() => {
        loader.style.opacity = '0';
        setTimeout(() => loader.remove(), 500);
      }, 300);
    }

    // Welcome notification to guide player
    setTimeout(() => {
      gameState.addNotification(
        'Welcome to Metro City!',
        'Explore your apartment, check the fridge for food, or sit at your PC desk to launch your first stream!'
      );
    }, 1500);

    // Start Main Loop
    this.animate();
  }

  onResize() {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = Math.min(0.1, this.clock.getDelta());

    // Update Core Game Systems
    timeWeatherSystem.update(delta);
    const daylight = timeWeatherSystem.getDaylightFactor();

    needsSystem.update(delta);
    streamEngine.update(delta);
    economySystem.checkMilestones();

    // Update World & Dynamic Props
    this.worldBuilder.update(delta, daylight);

    // Update First-Person Controller & Physics
    this.playerController.update(delta);

    // Update HUD stats
    this.uiOverlay.updateStats();

    // Render 3D Scene
    this.renderer.render(this.scene, this.camera);
  }
}

// Start Game on page load
window.addEventListener('DOMContentLoaded', () => {
  window.gameApp = new GameApp();
});
