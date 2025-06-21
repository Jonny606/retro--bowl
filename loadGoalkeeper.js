import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

loader.load('/models/Goalkeeper.glb', function(gltf) {
  scene.add(gltf.scene);
  // Optionally: gltf.animations for animation clips
}, undefined, function(error) {
  console.error(error);
});
