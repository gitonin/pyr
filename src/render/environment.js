import { THREE, gfx, PALETTE } from './renderer.js';

/**
 * The world around the hourglass: gradient sky, wet reflective ground, the
 * distant red neon line, volumetric light shaft and floating dust.
 * Everything here is decorative and cheap — no shadow maps, no post pass.
 */

const HASH = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise21(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
`;

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.uniforms = {
      uTime: { value: 0 },
      uGlow: { value: 1 },
      uDanger: { value: 0 },
      uLean: { value: new THREE.Vector2() },
      uContrast: { value: 0 },
    };
    this._build();
  }

  _build() {
    this._buildSky();
    this._buildFloor();
    this._buildNeon();
    this._buildLightShaft();
    this._buildDust();
    this._buildLights();
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(46, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vPos;
        uniform float uTime;
        uniform float uDanger;
        ${HASH}
        void main() {
          vec3 dir = normalize(vPos);
          float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 top = vec3(0.005, 0.014, 0.038);
          vec3 mid = vec3(0.014, 0.055, 0.115);
          vec3 horizon = vec3(0.032, 0.13, 0.215);
          vec3 col = mix(horizon, mid, smoothstep(0.48, 0.62, h));
          col = mix(col, top, smoothstep(0.6, 0.95, h));
          // Slow drifting haze so the backdrop is never perfectly flat.
          float haze = noise21(dir.xz * 3.0 + vec2(uTime * 0.012, uTime * 0.008));
          col += haze * 0.022 * (1.0 - abs(dir.y));
          col = mix(col, col * vec3(1.5, 0.55, 0.6), uDanger * 0.35);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  _buildFloor() {
    const geo = new THREE.PlaneGeometry(64, 64, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      // merge() deep-clones, which would sever the shared uniform objects, so
      // the fog block is cloned separately and ours are spliced in by reference.
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
        uTime: this.uniforms.uTime,
        uGlow: this.uniforms.uGlow,
        uDanger: this.uniforms.uDanger,
        uLean: this.uniforms.uLean,
        uContrast: this.uniforms.uContrast,
      }),
      fog: true,
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        varying vec3 vWorld;
        void main() {
          vWorld = position;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          #include <fog_vertex>
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        varying vec3 vWorld;
        uniform float uTime;
        uniform float uGlow;
        uniform float uDanger;
        uniform float uContrast;
        uniform vec2 uLean;
        ${HASH}
        void main() {
          vec2 p = vWorld.xz; // p.x = world X, p.y = world Z
          float dist = length(p);

          vec3 base = mix(vec3(0.012, 0.036, 0.07), vec3(0.003, 0.009, 0.021),
                          smoothstep(1.0, 16.0, dist));

          // Pool of cyan light cast by the hourglass, offset by its lean.
          vec2 c = p - uLean * 0.7;
          float pool = exp(-dot(c, c) * 0.24) * uGlow;
          vec3 col = base + vec3(0.06, 0.42, 0.6) * pool * 0.55;

          // Vertical smear: the object's reflection on the wet ground.
          float smear = exp(-abs(c.x) * 3.2) * exp(-max(0.0, -c.y) * 0.2)
                        * exp(-max(0.0, c.y + 0.4) * 0.55);
          col += vec3(0.1, 0.6, 0.8) * smear * 0.32 * uGlow;

          // Red neon reflection sitting on the horizon line.
          float neon = exp(-abs(p.y + 12.5) * 0.14) * exp(-abs(p.x) * 0.05);
          col += vec3(0.9, 0.12, 0.1) * neon * 0.22;

          // Wet grain: sparse bright specks that catch the light.
          float g = noise21(p * 26.0);
          float sparkle = smoothstep(0.86, 1.0, g) * (0.35 + pool * 2.2);
          float twinkle = 0.6 + 0.4 * sin(uTime * 2.1 + hash21(floor(p * 26.0)) * 40.0);
          col += vec3(0.35, 0.75, 0.95) * sparkle * twinkle * 0.5;
          float redSpeck = smoothstep(0.975, 1.0, noise21(p * 18.0 + 7.0));
          col += vec3(1.0, 0.25, 0.15) * redSpeck * (0.25 + neon * 1.5);

          // Shallow puddles: darker patches with a sharper highlight.
          float wet = smoothstep(0.55, 0.85, noise21(p * 1.3 + vec2(0.0, uTime * 0.01)));
          col = mix(col, col * 0.55 + vec3(0.02, 0.12, 0.2) * pool, wet * 0.5);

          col = mix(col, col * vec3(1.6, 0.5, 0.5), uDanger * 0.5);
          col = mix(col, pow(col, vec3(0.78)) * 1.15, uContrast);

          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }
      `,
    });
    this.floor = new THREE.Mesh(geo, mat);
    this.floor.position.y = 0;
    this.scene.add(this.floor);
  }

  _buildNeon() {
    this.neonGroup = new THREE.Group();
    // A thin, distant filament — the one warm accent in an otherwise cold scene.
    const barGeo = new THREE.PlaneGeometry(3.4, 0.035);
    const barMat = new THREE.MeshBasicMaterial({
      color: PALETTE.red,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const bar = new THREE.Mesh(barGeo, barMat);
    bar.position.set(0, 0.62, -12.5);
    this.neonGroup.add(bar);

    // A flat plane would read as a rectangle; the halo needs a soft falloff.
    const haloMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(PALETTE.red) } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform vec3 uColor;
        void main() {
          vec2 d = vUv - 0.5;
          float a = exp(-abs(d.y) * 14.0) * exp(-abs(d.x) * 3.2) * 0.22;
          gl_FragColor = vec4(uColor * a, a);
        }
      `,
    });
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 1.1), haloMat);
    halo.position.set(0, 0.62, -12.55);
    this.neonGroup.add(halo);

    // Distant city lights along the shoreline.
    const dots = new THREE.Group();
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.11, 0.05),
        new THREE.MeshBasicMaterial({
          color: i % 5 === 0 ? PALETTE.ember : PALETTE.cyanSoft,
          transparent: true,
          opacity: 0.18 + Math.random() * 0.4,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        })
      );
      const side = i < 13 ? 1 : -1;
      m.position.set(side * (3.4 + Math.random() * 9), 0.6 + Math.random() * 0.05, -13 - Math.random() * 5);
      dots.add(m);
    }
    this.cityDots = dots;
    this.neonGroup.add(dots);
    this.neonBar = bar;
    this.scene.add(this.neonGroup);
  }

  _buildLightShaft() {
    const geo = new THREE.CylinderGeometry(0.05, 2.2, 5.2, 24, 1, true);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: this.uniforms.uTime,
        uGlow: this.uniforms.uGlow,
        uDanger: this.uniforms.uDanger,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vView;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uGlow;
        uniform float uDanger;
        void main() {
          float vert = smoothstep(0.0, 0.55, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
          float band = 0.75 + 0.25 * sin(vUv.y * 12.0 - uTime * 0.6);
          vec3 col = mix(vec3(0.1, 0.55, 0.8), vec3(0.9, 0.2, 0.2), uDanger);
          float a = vert * band * 0.16 * uGlow;
          gl_FragColor = vec4(col * a, a);
        }
      `,
    });
    this.shaft = new THREE.Mesh(geo, mat);
    this.shaft.position.set(0, 2.4, -0.2);
    this.scene.add(this.shaft);
  }

  _buildDust() {
    const count = gfx.particleBudget;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 14;
      pos[i * 3 + 1] = Math.random() * 6;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 12 - 1;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: this.uniforms.uTime,
        uGlow: this.uniforms.uGlow,
        uDanger: this.uniforms.uDanger,
        uSize: { value: 26 * Math.min(window.devicePixelRatio || 1, 2) },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        varying float vSeed;
        varying float vFade;
        uniform float uTime;
        uniform float uSize;
        void main() {
          vSeed = aSeed;
          vec3 p = position;
          float t = uTime * (0.06 + aSeed * 0.12);
          p.x += sin(t * 1.7 + aSeed * 33.0) * 0.5;
          p.y += mod(t * 0.55, 6.0) - 3.0;
          p.y = mod(p.y + 6.0, 6.0);
          p.z += cos(t * 1.3 + aSeed * 21.0) * 0.4;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vFade = smoothstep(30.0, 3.0, -mv.z) * smoothstep(0.0, 1.0, p.y);
          gl_PointSize = uSize * (0.25 + aSeed * 0.8) / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vSeed;
        varying float vFade;
        uniform float uGlow;
        uniform float uDanger;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d);
          if (r > 0.25) discard;
          float a = (1.0 - r * 4.0);
          a *= a * vFade * (0.16 + vSeed * 0.3) * uGlow;
          vec3 col = mix(vec3(0.45, 0.85, 1.0), vec3(1.0, 0.35, 0.3),
                         step(0.9, vSeed) * 0.8 + uDanger * 0.4);
          gl_FragColor = vec4(col * a, a);
        }
      `,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  _buildLights() {
    this.ambient = new THREE.AmbientLight(0x2a5f88, 0.55);
    this.scene.add(this.ambient);

    this.keyLight = new THREE.PointLight(PALETTE.cyan, 6, 12, 2);
    this.keyLight.position.set(0.6, 2.6, 1.4);
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.PointLight(PALETTE.turquoise, 4, 10, 2);
    this.rimLight.position.set(-1.8, 1.4, -1.6);
    this.scene.add(this.rimLight);

    this.emberLight = new THREE.PointLight(PALETTE.red, 2.4, 14, 2);
    this.emberLight.position.set(0, 0.7, -6.5);
    this.scene.add(this.emberLight);

    this.coreLight = new THREE.PointLight(PALETTE.cyanSoft, 2.5, 4, 2);
    this.coreLight.position.set(0, 1.05, 0);
    this.scene.add(this.coreLight);
  }

  setContrast(on) {
    this.uniforms.uContrast.value = on ? 1 : 0;
    this.ambient.intensity = on ? 0.85 : 0.55;
  }

  rebuildDust() {
    if (this.dust) {
      this.scene.remove(this.dust);
      this.dust.geometry.dispose();
      this.dust.material.dispose();
    }
    this._buildDust();
  }

  update(dt, time, ctx = {}) {
    const danger = ctx.danger || 0;
    const glow = ctx.glow ?? 1;
    this.uniforms.uTime.value = time;
    this.uniforms.uDanger.value += (danger - this.uniforms.uDanger.value) * Math.min(1, dt * 5);
    this.uniforms.uGlow.value += (glow - this.uniforms.uGlow.value) * Math.min(1, dt * 3);
    if (ctx.lean) this.uniforms.uLean.value.set(ctx.lean.x, ctx.lean.y);

    const d = this.uniforms.uDanger.value;
    this.coreLight.color.setHex(d > 0.5 ? PALETTE.red : PALETTE.cyanSoft);
    this.coreLight.intensity = 2.2 + Math.sin(time * 2.4) * 0.35 + d * 2.5;
    this.keyLight.intensity = 6 * this.uniforms.uGlow.value;
    this.neonBar.material.opacity = 0.45 + Math.sin(time * 1.7) * 0.06 + d * 0.3;
    this.shaft.rotation.y = time * 0.05;
  }
}
