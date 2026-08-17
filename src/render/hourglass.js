import { THREE, gfx, PALETTE, FOG } from './renderer.js';
import { clamp, lerp, damp } from '../core/utils.js';

/**
 * The hourglass: two square pyramids tip to tip.
 *
 *   topGroup   pivots exactly on the contact point, apex pointing down,
 *              holding the sand that has not fallen yet.
 *   bottomGroup apex pointing up, catching the sand as a growing heap.
 *
 * Sand volume is preserved: a pyramid anchored at its apex scaled by f has
 * volume f^3, so the visual fill is cbrt(fraction) in both halves.
 */

export const PYRAMID_H = 0.92;
export const PYRAMID_R = 0.86; // apex-to-corner radius
export const CENTER_Y = 1.06;

const GLASS_VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec3 vLocal;
  varying float vFogDepth;
  void main() {
    vLocal = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = normalize(cameraPosition - world.xyz);
    vec4 mv = viewMatrix * world;
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const GLASS_FRAG = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec3 vLocal;
  varying float vFogDepth;

  uniform vec3 uTint;
  uniform vec3 uEdge;
  uniform float uTime;
  uniform float uDanger;
  uniform float uOpacity;
  uniform float uDetail;
  uniform vec3 fogColor;
  uniform float fogDensity;

  void main() {
    vec3 N = normalize(vNormalW);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(vViewW);
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);

    // Cheap refraction cue: bend the view vector and sample a vertical gradient.
    vec3 R = refract(-V, N, 0.72);
    float grad = clamp(R.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 body = mix(uTint * 0.08, uTint * 0.42, grad);

    // Imperfections: smooth internal veils, not blocks — a hashed grid reads
    // as pixel noise at this scale and destroys the illusion of glass.
    float flaw = 0.0;
    if (uDetail > 0.5) {
      float veil = sin(vLocal.y * 14.0 + uTime * 0.15)
                 * sin(vLocal.x * 11.0 + 1.7)
                 * sin(vLocal.z * 13.0 - 0.6);
      float fine = sin(vLocal.y * 41.0 - uTime * 0.09) * sin(vLocal.x * 37.0);
      flaw = smoothstep(0.25, 1.0, veil) * 0.16 + smoothstep(0.6, 1.0, fine) * 0.07;
    }

    // Two speculars stand in for the key light and the distant neon.
    vec3 L1 = normalize(vec3(0.35, 0.9, 0.5));
    vec3 L2 = normalize(vec3(-0.4, 0.2, -1.0));
    float s1 = pow(max(dot(reflect(-V, N), L1), 0.0), 48.0);
    float s2 = pow(max(dot(reflect(-V, N), L2), 0.0), 18.0);

    vec3 col = body + uEdge * fres * 1.35 + vec3(1.0) * s1 * 0.9
             + vec3(1.0, 0.25, 0.2) * s2 * 0.55 + uTint * flaw;
    col = mix(col, vec3(1.0, 0.16, 0.18) * (0.6 + fres), uDanger * 0.75);

    float alpha = clamp(uOpacity * (0.07 + fres * 0.72 + s1 * 0.55 + flaw * 0.45), 0.0, 1.0);

    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    col = mix(col, fogColor, fogFactor);

    // The WebGL context is premultiplied-alpha, so the colour must be scaled
    // by alpha here; emitting straight alpha blows the glass out to white/red.
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

function makeGlassMaterial(side, detail) {
  return new THREE.ShaderMaterial({
    vertexShader: GLASS_VERT,
    fragmentShader: GLASS_FRAG,
    transparent: true,
    depthWrite: false,
    side,
    blending: THREE.NormalBlending,
    uniforms: {
      uTint: { value: new THREE.Color(0x2f9fd0) },
      uEdge: { value: new THREE.Color(PALETTE.cyan) },
      uTime: { value: 0 },
      uDanger: { value: 0 },
      uOpacity: { value: 1 },
      uDetail: { value: detail },
      fogColor: { value: new THREE.Color(FOG.color) },
      fogDensity: { value: FOG.density },
    },
  });
}

const SAND_FRAG = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying float vFogDepth;
  uniform float uTime;
  uniform float uAgitation;
  uniform vec3 uColor;
  uniform vec3 fogColor;
  uniform float fogDensity;

  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 27.13;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    // Grain that drifts when the pyramid is disturbed.
    vec3 q = vLocal * 150.0 + vec3(uAgitation * 8.0, uTime * 1.2 * uAgitation, 0.0);
    float g = hash31(floor(q));
    float speck = smoothstep(0.72, 1.0, g);

    float lightWrap = clamp(normalize(vNormalW).y * 0.5 + 0.6, 0.0, 1.0);
    vec3 col = uColor * (0.35 + lightWrap * 0.6);
    col += vec3(0.2, 0.5, 0.78) * speck * (0.14 + uAgitation * 0.4);

    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    col = mix(col, fogColor, fogFactor);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function makeSandMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAgitation: { value: 0 },
      uColor: { value: new THREE.Color(0x0c2246) },
      fogColor: { value: new THREE.Color(FOG.color) },
      fogDensity: { value: FOG.density },
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vNormalW;
      varying float vFogDepth;
      void main() {
        vLocal = position;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: SAND_FRAG,
  });
}

export class Hourglass {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.materials = [];
    this.danger = 0;
    this.remaining = 1;
    this.agitation = 0;
    this.fallen = false;
    this._fall = null;
    this._breath = 0;
    this.visualLean = new THREE.Vector2();
    this._edgeColor = new THREE.Color();
    this._calm = new THREE.Color(PALETTE.cyan);
    this._alarm = new THREE.Color(PALETTE.red);

    this._buildBottom();
    this._buildTop();
    this._buildStream();
    scene.add(this.root);
  }

  // ---- construction -----------------------------------------------------

  _glassPair(geometry, parent) {
    const detail = gfx.quality === 'low' ? 0 : 1;
    const back = new THREE.Mesh(geometry, makeGlassMaterial(THREE.BackSide, detail));
    const front = new THREE.Mesh(geometry, makeGlassMaterial(THREE.FrontSide, detail));
    back.renderOrder = 2;
    front.renderOrder = 3;
    parent.add(back, front);
    this.materials.push(back.material, front.material);
    return { back, front };
  }

  _edges(geometry, parent, scale = 1) {
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 1),
      new THREE.LineBasicMaterial({
        color: PALETTE.cyan,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      })
    );
    edges.scale.setScalar(scale);
    edges.renderOrder = 4;
    parent.add(edges);
    return edges;
  }

  /** Slightly inflated additive shell — stands in for a bloom pass. */
  _halo(geometry, parent) {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(PALETTE.cyan) },
        uStrength: { value: 0.22 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - world.xyz);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV;
        uniform vec3 uColor; uniform float uStrength;
        void main() {
          float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
          float a = f * uStrength;
          gl_FragColor = vec4(uColor * a, a);
        }
      `,
    });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.scale.setScalar(1.045);
    mesh.renderOrder = 1;
    parent.add(mesh);
    return mesh;
  }

  _buildBottom() {
    this.bottomGroup = new THREE.Group();
    this.bottomGroup.position.set(0, CENTER_Y, 0);
    this.root.add(this.bottomGroup);

    const geo = new THREE.ConeGeometry(PYRAMID_R, PYRAMID_H, 4, 1);
    geo.rotateY(Math.PI / 4);
    geo.translate(0, -PYRAMID_H / 2, 0); // apex now sits at the group origin

    this.bottomGlass = this._glassPair(geo, this.bottomGroup);
    this.bottomEdges = this._edges(geo, this.bottomGroup);
    this.bottomHalo = this._halo(geo, this.bottomGroup);

    // The heap: a pyramid standing on the floor of the lower half.
    const heapGeo = new THREE.ConeGeometry(PYRAMID_R * 0.93, PYRAMID_H * 0.98, 4, 1);
    heapGeo.rotateY(Math.PI / 4);
    heapGeo.translate(0, (PYRAMID_H * 0.98) / 2, 0);
    this.heapMat = makeSandMaterial();
    this.heap = new THREE.Mesh(heapGeo, this.heapMat);
    this.heap.position.y = -PYRAMID_H;
    this.heap.scale.setScalar(0.001);
    this.heap.renderOrder = 0;
    this.bottomGroup.add(this.heap);
  }

  _buildTop() {
    this.topGroup = new THREE.Group();
    this.topGroup.position.set(0, CENTER_Y, 0);
    this.root.add(this.topGroup);

    const geo = new THREE.ConeGeometry(PYRAMID_R, PYRAMID_H, 4, 1);
    geo.rotateY(Math.PI / 4);
    geo.rotateX(Math.PI); // apex down
    geo.translate(0, PYRAMID_H / 2, 0); // apex at the group origin

    this.topGlass = this._glassPair(geo, this.topGroup);
    this.topEdges = this._edges(geo, this.topGroup);
    this.topHalo = this._halo(geo, this.topGroup);

    const sandGeo = new THREE.ConeGeometry(PYRAMID_R * 0.93, PYRAMID_H * 0.98, 4, 1);
    sandGeo.rotateY(Math.PI / 4);
    sandGeo.rotateX(Math.PI);
    sandGeo.translate(0, (PYRAMID_H * 0.98) / 2, 0);
    this.topSandMat = makeSandMaterial();
    this.topSand = new THREE.Mesh(sandGeo, this.topSandMat);
    this.topSand.renderOrder = 0;
    this.topGroup.add(this.topSand);
  }

  /** CPU-driven grain stream through the contact point. */
  _buildStream() {
    const count = gfx.quality === 'low' ? 40 : 110;
    this.streamCount = count;
    this.streamData = new Float32Array(count * 4); // y, vx, vz, life
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.streamData[i * 4 + 3] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.streamGeo = geo;
    this.stream = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0x7fd8ff,
        size: 0.022,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      })
    );
    this.stream.frustumCulled = false;
    this.stream.renderOrder = 5;
    this.root.add(this.stream);
  }

  // ---- state ------------------------------------------------------------

  /** @param lean {x, z} lean angles in radians. */
  setLean(lean) {
    if (this.fallen) return;
    this.topGroup.rotation.z = -lean.x;
    this.topGroup.rotation.x = lean.z;
    // The lower half yields a little, as if the whole object shared the load.
    this.bottomGroup.rotation.z = -lean.x * 0.12;
    this.bottomGroup.rotation.x = lean.z * 0.12;
    this.visualLean.set(lean.x, lean.z);
  }

  setSandRemaining(f) {
    this.remaining = clamp(f, 0, 1);
    const top = Math.cbrt(this.remaining);
    const bottom = Math.cbrt(1 - this.remaining);
    this.topSand.scale.setScalar(Math.max(0.0001, top));
    this.topSand.visible = top > 0.01;
    this.heap.scale.setScalar(Math.max(0.0001, bottom));
    this.heap.visible = bottom > 0.01;
  }

  setDanger(d) {
    this.danger = clamp(d, 0, 1);
  }

  setAgitation(a) {
    this.agitation = clamp(a, 0, 1);
  }

  setOpacity(o) {
    for (const m of this.materials) m.uniforms.uOpacity.value = o;
    this.topEdges.material.opacity = 0.95 * o;
    this.bottomEdges.material.opacity = 0.95 * o;
  }

  /** Breathing idle used on the intro and success screens. */
  setBreathing(on) {
    this._breathing = on;
  }

  topple(dirX = 1, dirZ = 0) {
    if (this.fallen) return;
    this.fallen = true;
    const mag = Math.hypot(dirX, dirZ) || 1;
    this._fall = {
      vx: (dirX / mag) * 1.5 + (Math.random() - 0.5) * 0.4,
      // Falling toward the camera fills the frame with debris, so that
      // component is damped hard: the object always topples away or sideways.
      vz: Math.min((dirZ / mag) * 1.5, 0.35) + (Math.random() - 0.5) * 0.3,
      vy: 0.7,
      spin: (Math.random() - 0.5) * 2.2,
      t: 0,
    };
  }

  reset() {
    this.fallen = false;
    this._fall = null;
    this.topGroup.position.set(0, CENTER_Y, 0);
    this.topGroup.rotation.set(0, 0, 0);
    this.bottomGroup.position.set(0, CENTER_Y, 0);
    this.bottomGroup.rotation.set(0, 0, 0);
    this.setSandRemaining(1);
    this.setDanger(0);
    this.setOpacity(1);
    this.root.visible = true;
  }

  // ---- frame ------------------------------------------------------------

  update(dt, time) {
    const d = this.danger;
    const edgeColor = this._edgeColor.copy(this._calm).lerp(this._alarm, d);
    this.topEdges.material.color.copy(edgeColor);
    this.bottomEdges.material.color.copy(edgeColor);
    this.topHalo.material.uniforms.uColor.value.copy(edgeColor);
    this.bottomHalo.material.uniforms.uColor.value.copy(edgeColor);
    const pulse = 0.2 + Math.sin(time * (2 + d * 9)) * 0.06 + d * 0.35;
    this.topHalo.material.uniforms.uStrength.value = pulse;
    this.bottomHalo.material.uniforms.uStrength.value = pulse * 0.8;

    for (const m of this.materials) {
      m.uniforms.uTime.value = time;
      m.uniforms.uDanger.value = d;
      m.uniforms.uEdge.value.copy(edgeColor);
    }
    this.topSandMat.uniforms.uTime.value = time;
    this.heapMat.uniforms.uTime.value = time;
    this.topSandMat.uniforms.uAgitation.value = this.agitation;
    this.heapMat.uniforms.uAgitation.value = this.agitation * 0.4;

    if (this._breathing && !this.fallen) {
      const b = Math.sin(time * 0.9) * 0.012;
      this.root.position.y = b;
      this.topGroup.rotation.z = Math.sin(time * 0.37) * 0.045;
      this.topGroup.rotation.x = Math.cos(time * 0.29) * 0.035;
    } else if (!this.fallen) {
      this.root.position.y = damp(this.root.position.y, 0, 4, dt);
    }

    if (this._fall) this._updateFall(dt);
    this._updateStream(dt);
  }

  _updateFall(dt) {
    const f = this._fall;
    f.t += dt;
    f.vy -= 9.4 * dt;
    const g = this.topGroup;
    g.position.x += f.vx * dt;
    g.position.z += f.vz * dt;
    g.position.y += f.vy * dt;
    g.rotation.z -= f.vx * dt * 1.9;
    g.rotation.x += f.vz * dt * 1.9;
    g.rotation.y += f.spin * dt;
    if (g.position.y < 0.35) {
      g.position.y = 0.35;
      f.vy = Math.abs(f.vy) * 0.28;
      f.vx *= 0.55;
      f.vz *= 0.55;
      f.spin *= 0.5;
    }
    // The lower half is knocked off balance a beat later.
    if (f.t > 0.18) {
      const b = this.bottomGroup;
      b.rotation.z -= f.vx * dt * 0.9;
      b.rotation.x += f.vz * dt * 0.9;
      b.position.x += f.vx * dt * 0.25;
    }
  }

  _updateStream(dt) {
    const flowing = this.remaining > 0.001 && this.remaining < 1 && !this.fallen;
    this.stream.visible = flowing;
    if (!flowing) return;

    const arr = this.streamGeo.attributes.position.array;
    const data = this.streamData;
    const heapTop = CENTER_Y - PYRAMID_H + PYRAMID_H * 0.98 * Math.cbrt(1 - this.remaining);
    const drop = CENTER_Y - heapTop;
    const leanX = this.visualLean.x;
    const leanZ = this.visualLean.y;

    for (let i = 0; i < this.streamCount; i++) {
      const o = i * 4;
      data[o + 3] += dt * (1.1 + this.remaining * 0.5);
      if (data[o + 3] >= 1) {
        data[o + 3] -= 1;
        data[o + 1] = (Math.random() - 0.5) * 0.012;
        data[o + 2] = (Math.random() - 0.5) * 0.012;
      }
      const t = data[o + 3];
      const y = CENTER_Y - drop * t * t; // accelerating fall
      // Grains keep the horizontal momentum the tilted apex gave them.
      const spread = t * t * 0.5;
      arr[i * 3] = data[o + 1] * 30 * spread + leanX * spread * 0.7;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = data[o + 2] * 30 * spread + leanZ * spread * 0.7;
    }
    this.streamGeo.attributes.position.needsUpdate = true;
    this.stream.material.opacity = 0.5 + this.remaining * 0.4;
  }

  setVisible(v) {
    this.root.visible = v;
  }

  dispose() {
    this.scene.remove(this.root);
  }
}
