import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as CANNON from 'cannon-es';

// --- DOM Elements ---
const sceneContainer = document.getElementById('scene-container');
const levelDisplay = document.getElementById('level-display');
const coinsDisplay = document.getElementById('coins-display');
const messageDisplay = document.getElementById('message-display');
const storeOverlay = document.getElementById('store-overlay');
const openStoreButton = document.getElementById('open-store-button');
const closeStoreButton = document.getElementById('close-store-button');
const packVisual = document.getElementById('pack-visual');
const packCostDisplay = document.getElementById('pack-cost');
const packMessage = document.getElementById('pack-message');
const packRevealItem = document.getElementById('pack-reveal-item');
const packRevealDesc = document.getElementById('pack-reveal-desc');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingIndicator = document.getElementById('loading-indicator');
const loadingProgressBarInner = document.getElementById('loading-progress-bar-inner');
const powerMeterContainer = document.getElementById('power-meter-container');
const powerMeterBar = document.getElementById('power-meter-bar');


// --- Game State & Data ---
let gameState = 'loading'; // loading, aiming, charging, shooting, ended
let playerData = {
    level: 1,
    coins: 0,
    shots: 0,
    goals: 0,
    upgrades: {
        power: 1.0,
        aimAssist: 0.1
    }
};
const PACK_COST = 100;
let shootTarget = new THREE.Vector3();
let powerInterval;
let shotPower = 0;
let lastBallPosition = new CANNON.Vec3();
loadPlayerData();

// --- Audio ---
let audioContext;
const audioBuffers = {};

async function loadAudio(name, path, manager) {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    try {
        const response = await fetch(path);
        const arrayBuffer = await response.arrayBuffer();
        audioBuffers[name] = await audioContext.decodeAudioData(arrayBuffer);
        manager.itemEnd(name); // Notify manager
    } catch (error) {
        console.error(`Failed to load audio: ${name}`, error);
        manager.itemError(name); // Notify manager of error
    }
}
function playSound(name) {
    if (!audioContext || !audioBuffers[name]) return;
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffers[name];
    source.connect(audioContext.destination);
    source.start(0);
}


// --- Scene Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.5, 12);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x87CEEB);
renderer.shadowMap.enabled = true;
sceneContainer.appendChild(renderer.domElement);

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 7.5);
directionalLight.castShadow = true;
scene.add(directionalLight);

// --- Loading Manager ---
const loadingManager = new THREE.LoadingManager();
loadingManager.onStart = (url, itemsLoaded, itemsTotal) => {
    console.log(`Started loading: ${itemsLoaded}/${itemsTotal} items.`);
    loadingOverlay.style.display = 'flex';
};
loadingManager.onLoad = () => {
    console.log('Loading complete!');
    loadingOverlay.style.display = 'none';
    if(gameState === 'loading') resetRound();
};
loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
    const progress = itemsLoaded / itemsTotal;
    loadingProgressBarInner.style.width = `${progress * 100}%`;
    loadingIndicator.textContent = `Loading ${url.split('/').pop()}...`;
};
loadingManager.onError = (url) => {
    console.error('There was an error loading ' + url);
    loadingIndicator.textContent = `Error loading assets. Please refresh.`;
};


// --- Physics Setup ---
const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0),
});

// Define physics materials
const ballMaterial = new CANNON.Material('ball');
const postMaterial = new CANNON.Material('post');
const keeperMaterial = new CANNON.Material('keeper');

// Contact material definitions
const ballPostContactMaterial = new CANNON.ContactMaterial(ballMaterial, postMaterial, {
    friction: 0.2,
    restitution: 0.6, // Bouncy
});
world.addContactMaterial(ballPostContactMaterial);

const ballKeeperContactMaterial = new CANNON.ContactMaterial(ballMaterial, keeperMaterial, {
    friction: 0.3,
    restitution: 0.1, // Not very bouncy, like hitting gloves
});
world.addContactMaterial(ballKeeperContactMaterial);

// --- Textures ---
const textureLoader = new THREE.TextureLoader(loadingManager);
const grassTexture = textureLoader.load('grass.png');
grassTexture.wrapS = THREE.RepeatWrapping;
grassTexture.wrapT = THREE.RepeatWrapping;
grassTexture.repeat.set(20, 20);

// Ground
const groundGeo = new THREE.PlaneGeometry(50, 50);
const groundMat = new THREE.MeshLambertMaterial({ map: grassTexture });
const groundMesh = new THREE.Mesh(groundGeo, groundMat);
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.receiveShadow = true;
scene.add(groundMesh);
const groundBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Plane(),
});
groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
world.addBody(groundBody);

// Ball
const ballRadius = 0.22;
const ballGeo = new THREE.SphereGeometry(ballRadius, 32, 32);
const ballMat = new THREE.MeshStandardMaterial({
    map: textureLoader.load('soccer_ball.png'),
    roughness: 0.4,
    metalness: 0.1
});
const ballMesh = new THREE.Mesh(ballGeo, ballMat);
ballMesh.position.set(0, ballRadius, 9.5);
ballMesh.castShadow = true;
scene.add(ballMesh);
const ballBody = new CANNON.Body({
    mass: 1,
    shape: new CANNON.Sphere(ballRadius),
    material: ballMaterial,
    linearDamping: 0.1, // Add some air resistance
    angularDamping: 0.1,
});
ballBody.position.copy(ballMesh.position);
world.addBody(ballBody);
lastBallPosition.copy(ballBody.position); // Initialize last position

// Goal
const goal = new THREE.Group();
const postMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const postGeo = new THREE.CylinderGeometry(0.1, 0.1, 2.44, 16);
const crossbarGeo = new THREE.CylinderGeometry(0.1, 0.1, 7.32, 16);

const leftPost = new THREE.Mesh(postGeo, postMat);
leftPost.position.set(-3.66, 1.22, 0);
leftPost.castShadow = true;

const rightPost = new THREE.Mesh(postGeo, postMat);
rightPost.position.set(3.66, 1.22, 0);
rightPost.castShadow = true;

const crossbar = new THREE.Mesh(crossbarGeo, postMat);
crossbar.position.set(0, 2.44, 0);
crossbar.rotation.z = Math.PI / 2;
crossbar.castShadow = true;

goal.add(leftPost, rightPost, crossbar);
scene.add(goal);

// Goal Physics Bodies
const postShape = new CANNON.Cylinder(0.1, 0.1, 2.44, 16);
const crossbarShape = new CANNON.Cylinder(0.1, 0.1, 7.32, 16);

const leftPostbody = new CANNON.Body({ mass: 0, shape: postShape, material: postMaterial });
leftPostbody.position.set(-3.66, 1.22, 0);
world.addBody(leftPostbody);

const rightPostbody = new CANNON.Body({ mass: 0, shape: postShape, material: postMaterial });
rightPostbody.position.set(3.66, 1.22, 0);
world.addBody(rightPostbody);

const crossbarBody = new CANNON.Body({ mass: 0, shape: crossbarShape, material: postMaterial });
crossbarBody.position.set(0, 2.44, 0);
const q = new CANNON.Quaternion();
q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), Math.PI / 2);
crossbarBody.quaternion = q;
world.addBody(crossbarBody);

// Goal Line (for detection)
const goalPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const goalBoundingBox = new THREE.Box3(
    new THREE.Vector3(-3.66, 0, -0.1), // a little tolerance on z
    new THREE.Vector3(3.66, 2.44, 0.1)
);

// Goalkeeper
const keeperBody = new CANNON.Body({
    mass: 0, // Static body, movement controlled by animation/lerping
    shape: new CANNON.Box(new CANNON.Vec3(0.5, 1, 0.5)),
    material: keeperMaterial,
});
keeperBody.position.set(0, 1, 0);
world.addBody(keeperBody);

let keeperMixer, keeperActions = {};
let keeperTargetX = 0;
let keeperDiveSpeed = 3; // Slightly increased speed
let keeperModel;

const gltfLoader = new GLTFLoader(loadingManager);
gltfLoader.load('goalkeeper.glb', (gltf) => {
    keeperModel = gltf.scene;
    keeperModel.scale.set(1.1, 1.1, 1.1);
    keeperModel.position.set(0, 0, 0);
    keeperModel.traverse(node => {
        if (node.isMesh) {
            node.castShadow = true;
        }
    });
    scene.add(keeperModel);

    keeperMixer = new THREE.AnimationMixer(keeperModel);
    const animations = gltf.animations;
    animations.forEach(clip => {
        const action = keeperMixer.clipAction(clip);
        keeperActions[clip.name] = action;
        if (clip.name.includes('dive')) {
            action.setLoop(THREE.LoopOnce);
            action.clampWhenFinished = true;
        }
    });
    playKeeperAnimation('idle');
    // Don't hide loading indicator or reset round here, handled by LoadingManager.onLoad
}, undefined, (error) => {
    console.error('Error loading goalkeeper model', error);
    // Create a placeholder if the model fails to load so the game can continue
    const keeperGeo = new THREE.BoxGeometry(0.8, 1.8, 0.5);
    const keeperMat = new THREE.MeshLambertMaterial({ color: 0xff0000 });
    keeperModel = new THREE.Mesh(keeperGeo, keeperMat);
    keeperModel.position.set(0, 0.9, 0); // Position placeholder correctly
    scene.add(keeperModel);
    // No animations, but the game won't be stuck on loading
});


// --- Controls ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
// Aiming plane behind the goal
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

function onMouseDown(event) {
    if (gameState === 'aiming') {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        const intersects = raycaster.ray.intersectPlane(aimPlane, shootTarget);
        if (intersects) {
            // Clamp the target to be within goal posts
            shootTarget.x = Math.max(-3.5, Math.min(3.5, shootTarget.x));
            shootTarget.y = Math.max(0.1, Math.min(2.3, shootTarget.y));
            
            gameState = 'charging';
            powerMeterContainer.style.display = 'block';
            shotPower = 0;
            powerInterval = setInterval(() => {
    shotPower = Math.min(100, shotPower + 1); // <--- now charges slower
    powerMeterBar.style.width = `${shotPower}%`;
}, 20);
             messageDisplay.textContent = 'Release to Shoot!';
        }
    }
}

function onMouseUp(event) {
    if (gameState !== 'charging') return;
    clearInterval(powerInterval);
    gameState = 'shooting';
    powerMeterContainer.style.display = 'none';
    messageDisplay.textContent = '';

    const shootDirection = new THREE.Vector3().subVectors(shootTarget, ballMesh.position).normalize();
    
    // Scale power: shotPower (0-100) -> impulse strength (e.g., 20-55)
    const impulseStrength = 10 + (shotPower / 100) * 40; // <--- lower min, higher max
    const finalImpulse = shootDirection.multiplyScalar(impulseStrength * playerData.upgrades.power);

    ballBody.applyImpulse(new CANNON.Vec3(finalImpulse.x, finalImpulse.y, finalImpulse.z), ballBody.position);
    lastBallPosition.copy(ballBody.position); // Reset last position on shoot
    
    ballBody.addEventListener('collide', (e) => {
        if (gameState !== 'shooting') return;
        if (e.body === leftPostbody || e.body === rightPostbody || e.body === crossbarBody) {
            playSound('post_hit');
        }
    });

    playSound('kick');
    startKeeperDive();
}

// --- Player Data Management ---
function savePlayerData() {
    localStorage.setItem('penaltyGameData', JSON.stringify(playerData));
}
function loadPlayerData() {
    const savedData = localStorage.getItem('penaltyGameData');
    if (savedData) {
        playerData = JSON.parse(savedData);
    }
    updateUI();
}

// --- UI Management ---
function updateUI() {
    levelDisplay.textContent = `Level: ${playerData.level}`;
    coinsDisplay.textContent = `Coins: ${playerData.coins}`;
    packCostDisplay.textContent = `Cost: ${PACK_COST} Coins`;
}

function showMessage(text, duration = 2000) {
    messageDisplay.textContent = text;
    if (duration > 0) {
        setTimeout(() => {
            if (messageDisplay.textContent === text) {
                messageDisplay.textContent = '';
            }
        }, duration);
    }
}

// --- Game Logic ---
function playKeeperAnimation(name, crossfade = 0.2) {
    if (!keeperMixer || !keeperActions[name]) {
        if (keeperModel) { // It's the placeholder
            console.warn(`Animation "${name}" not found! Placeholder has no animations.`);
        }
        return;
    }
    
    const currentAction = Object.values(keeperActions).find(action => action.isRunning());
    const newAction = keeperActions[name];

    if (currentAction && currentAction !== newAction) {
        currentAction.fadeOut(crossfade);
    }
    
    newAction.reset().fadeIn(crossfade).play();
}

function startKeeperDive() {
    const difficulty = playerData.level * 0.1; // 10% chance increase per level
    const keeperSaves = Math.random() < Math.min(0.2 + difficulty, 0.85);

    let diveAnimation = 'idle';

    if (keeperSaves) {
        // Aim towards ball's future position, with some error
        const aimError = 2.0 * (1.0 - playerData.upgrades.aimAssist);
        const randomError = (Math.random() - 0.5) * aimError;
        keeperTargetX = ballBody.position.x + randomError;
    } else {
        // Dive wrong way
        const diveDir = Math.random() > 0.5 ? 1 : -1;
        keeperTargetX = diveDir * (2 + Math.random());
    }
    keeperTargetX = Math.max(-3.5, Math.min(3.5, keeperTargetX));
    
    // Choose animation based on dive direction
    if (Math.abs(keeperTargetX) > 0.5) {
        diveAnimation = keeperTargetX > 0 ? 'dive_right' : 'dive_left';
    }
    playKeeperAnimation(diveAnimation);
}

function checkGoal() {
    // Check if the ball has moved past the goal line
    if (lastBallPosition.z >= 0 && ballBody.position.z < 0) {
        // Create a line segment for the ball's path this frame
        const ballPath = new THREE.Line3(
            new THREE.Vector3(lastBallPosition.x, lastBallPosition.y, lastBallPosition.z),
            new THREE.Vector3(ballMesh.position.x, ballMesh.position.y, ballMesh.position.z)
        );

        // Find the intersection point with the goal plane (z=0)
        const intersectionPoint = new THREE.Vector3();
        goalPlane.intersectLine(ballPath, intersectionPoint);

        // Check if the intersection point is within the goal's bounds
        if (intersectionPoint && goalBoundingBox.containsPoint(intersectionPoint)) {
            endRound('goal');
            return;
        }
    }

    // Update last position for the next frame
    lastBallPosition.copy(ballBody.position);

    // End round if ball stops or goes too far away
    if (ballBody.position.z < -10 || (ballBody.sleepState === CANNON.Body.SLEEPING && gameState === 'shooting')) {
        endRound('miss');
    }
}

function endRound(result) {
    if (gameState !== 'shooting') return;

    if (result === 'goal') {
        showMessage('GOAL!');
        playSound('goal');
        playerData.goals++;
        const coinsEarned = 10 + (playerData.level - 1) * 2;
        playerData.coins += coinsEarned;
        showMessage(`+${coinsEarned} Coins`, 2000);
        playerData.shots++;
        if (playerData.shots % 5 === 0) {
            playerData.level++;
            showMessage(`Level Up! Now Level ${playerData.level}`, 3000);
        }
    } else if (result === 'save') {
        showMessage('SAVED! Level Reset!', 2500);
        playSound('save');
        playerData.level = 1; // Reset level on save
        playerData.upgrades = { power: 1.0, aimAssist: 0.1 };
    } else { // Miss
        showMessage('MISS! Level Reset!', 2500);
        playerData.level = 1;
        playerData.upgrades = { power: 1.0, aimAssist: 0.1 };
    }
    
    gameState = 'ended';
    savePlayerData();
    updateUI();

    setTimeout(resetRound, 2500);
}

function resetRound() {
    ballBody.velocity.set(0, 0, 0);
    ballBody.angularVelocity.set(0, 0, 0);
    ballBody.position.set(0, ballRadius, 9.5);
    ballMesh.position.copy(ballBody.position);
    lastBallPosition.copy(ballBody.position);
    
    keeperTargetX = 0;
    if (keeperModel) {
       keeperModel.position.x = 0;
    }
    keeperBody.position.x = 0;
    playKeeperAnimation('idle');

    showMessage('Click on the goal to aim', 0);
    gameState = 'aiming'; // New initial state for shooting sequence
    sceneContainer.style.cursor = 'crosshair';
}

// --- Store Logic ---
openStoreButton.addEventListener('click', () => storeOverlay.classList.add('visible'));
closeStoreButton.addEventListener('click', () => storeOverlay.classList.remove('visible'));

packVisual.addEventListener('click', () => {
    if (packVisual.classList.contains('opening')) return;

    if (playerData.coins >= PACK_COST) {
        playerData.coins -= PACK_COST;
        savePlayerData();
        updateUI();
        packMessage.textContent = '';
        
        packVisual.classList.add('opening');
        playSound('pack_open');
        
        setTimeout(() => {
            const upgrade = openPack();
            packRevealItem.textContent = upgrade.name;
            packRevealDesc.textContent = upgrade.desc;
        }, 250); // half way through animation
        
        setTimeout(() => {
            packVisual.classList.remove('opening');
        }, 3000); // Reset after a while

    } else {
        packMessage.textContent = "Not enough coins!";
    }
});

function openPack() {
    const possibleUpgrades = [
        { key: 'power', name: 'Power Boost', desc: '+5% Shot Power', value: 0.05 },
        { key: 'aimAssist', name: 'Keeper Insight', desc: '+5% Aim Assist', value: 0.05 }
    ];
    const chosenUpgrade = possibleUpgrades[Math.floor(Math.random() * possibleUpgrades.length)];
    
    if (chosenUpgrade.key === 'power') {
        playerData.upgrades.power += chosenUpgrade.value;
    } else if (chosenUpgrade.key === 'aimAssist') {
        playerData.upgrades.aimAssist = Math.min(1.0, playerData.upgrades.aimAssist + chosenUpgrade.value);
    }
    
    savePlayerData();
    return chosenUpgrade;
}


// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);

    const deltaTime = 1 / 60;
    world.step(deltaTime);
    if(keeperMixer) keeperMixer.update(deltaTime);

    ballMesh.position.copy(ballBody.position);
    ballMesh.quaternion.copy(ballBody.quaternion);

    // Keeper movement
    if (keeperModel) {
        const keeperX = keeperModel.position.x;
        if (Math.abs(keeperX - keeperTargetX) > 0.01) {
            const move = (keeperTargetX - keeperX) * keeperDiveSpeed * deltaTime;
            keeperModel.position.x += move;
            keeperBody.position.x = keeperModel.position.x;
        }
    }

    if (gameState === 'shooting') {
        checkGoal();
    }
    
    // Use physics body for collision
    const ballSphere = new CANNON.Sphere(ballRadius);
    const keeperBoxShape = keeperBody.shapes[0];
    const collision = keeperBoxShape.volume() > 0 && ballSphere.volume() > 0 && keeperBody.aabb.overlaps(ballBody.aabb);
    
    if (collision && gameState === 'shooting') {
        const distVec = new CANNON.Vec3();
        ballBody.position.vsub(keeperBody.position, distVec);
        if (distVec.length() < (ballRadius + 0.8)) { // Approximate check
             endRound('save');
        }
    }

    renderer.render(scene, camera);
}

// --- Event Listeners ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
sceneContainer.addEventListener('mousedown', onMouseDown);
sceneContainer.addEventListener('mouseup', onMouseUp);
// No mousemove needed, calculated on mouseup
sceneContainer.addEventListener('mousemove', (e) => {
    if (gameState !== 'aiming') {
        sceneContainer.style.cursor = 'default';
        return;
    }
    sceneContainer.style.cursor = 'crosshair';
});

// --- Init ---
async function init() {
    // Audio loading now uses the manager to signal completion
    const audioLoaderManager = {
        itemStart: (name) => loadingManager.itemStart(name),
        itemEnd: (name) => loadingManager.itemEnd(name),
        itemError: (name) => loadingManager.itemError(name),
    };

    const audioFiles = ['kick', 'goal', 'save', 'pack_open', 'post_hit'];
    audioFiles.forEach(name => audioLoaderManager.itemStart(`${name}.mp3`));

    await Promise.all([
        loadAudio('kick', 'kick.mp3', audioLoaderManager),
        loadAudio('goal', 'goal.mp3', audioLoaderManager),
        loadAudio('save', 'save.mp3', audioLoaderManager),
        loadAudio('pack_open', 'pack_open.mp3', audioLoaderManager),
        loadAudio('post_hit', 'post_hit.mp3', audioLoaderManager),
    ]);
    // Don't call resetRound here; it's called by the main LoadingManager.onLoad when ready.
    animate();
}

init();
