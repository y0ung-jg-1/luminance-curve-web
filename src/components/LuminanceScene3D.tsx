import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildLuminanceScene3DData } from '../lib/luminanceScene3d';
import { formatNumber } from '../lib/format';
import type { CurveSeries, LuminanceBar3DDatum, PostProcessResult } from '../types';

export interface LuminanceScene3DHandle {
  exportPng: () => string | null;
}

interface LuminanceScene3DProps {
  visibleCurves: CurveSeries[];
  processedResult: PostProcessResult;
  theme: 'light' | 'dark';
}

interface BarMeshState {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  cap: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  datum: LuminanceBar3DDatum;
  targetHeight: number;
  xIndex: number;
  zIndex: number;
}

interface TooltipState {
  x: number;
  y: number;
  datum: LuminanceBar3DDatum;
}

const barWidth = 0.46;
const barDepth = 0.52;
const xSpacing = 1.08;
const zSpacing = 0.98;
const sceneHeight = 4.8;

const easeOutCubic = (value: number) => 1 - (1 - value) ** 3;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const truncateLabel = (value: string, maxLength: number) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;

const themeColors = (theme: 'light' | 'dark') => ({
  text: theme === 'dark' ? '#f5f5f7' : '#1d1d1f',
  muted: theme === 'dark' ? '#c6d1dc' : '#5f6872',
  backgroundFog: theme === 'dark' ? 0x19202a : 0xe9f1f7,
  ground: theme === 'dark' ? 0x202933 : 0xdfe8ee,
  grid: theme === 'dark' ? 0x536170 : 0xa4afba,
  bar: theme === 'dark' ? 0xd9e9f7 : 0xf3f8ff,
  axis: theme === 'dark' ? 0xb9c7d5 : 0x606a75,
  warmLight: theme === 'dark' ? 0xffd6a6 : 0xffc47b,
});

const makeTextSprite = (
  text: string,
  {
    color,
    fontSize = 30,
    width = 280,
    height = 64,
    weight = 700,
  }: {
    color: string;
    fontSize?: number;
    width?: number;
    height?: number;
    weight?: number;
  },
) => {
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;

  const context = canvas.getContext('2d');
  if (context) {
    context.scale(scale, scale);
    context.clearRect(0, 0, width, height);
    context.fillStyle = color;
    context.font = `${weight} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, width / 2, height / 2, width - 10);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width / 220, height / 220, 1);

  return sprite;
};

const disposeMaterial = (material: THREE.Material | THREE.Material[]) => {
  const materials = Array.isArray(material) ? material : [material];
  for (const item of materials) {
    const map = (item as THREE.Material & { map?: THREE.Texture | null }).map;
    map?.dispose();
    item.dispose();
  }
};

const disposeScene = (scene: THREE.Scene) => {
  scene.traverse((object) => {
    const candidate = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    candidate.geometry?.dispose();
    if (candidate.material) disposeMaterial(candidate.material);
  });
};

export const LuminanceScene3D = forwardRef<LuminanceScene3DHandle, LuminanceScene3DProps>(
  ({ visibleCurves, processedResult, theme }, ref) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);
    const sceneData = useMemo(
      () => buildLuminanceScene3DData(visibleCurves, processedResult),
      [processedResult, visibleCurves],
    );

    useImperativeHandle(
      ref,
      () => ({
        exportPng: () => {
          try {
            return rendererRef.current?.domElement.toDataURL('image/png') ?? null;
          } catch {
            return null;
          }
        },
      }),
      [],
    );

    useEffect(() => {
      const container = containerRef.current;
      if (!container || sceneData.bars.length === 0) {
        rendererRef.current = null;
        return undefined;
      }

      const colors = themeColors(theme);
      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(colors.backgroundFog, 8, 28);

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.className = 'scene3d-canvas';
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = true;
      controls.minPolarAngle = 0.48;
      controls.maxPolarAngle = 1.35;

      const xOrigin = 0;
      const zOrigin = 0;
      const xLast = xOrigin + (sceneData.levels.length - 1) * xSpacing;
      const zLast = zOrigin + Math.max(sceneData.curves.length - 1, 0) * zSpacing;
      const xCenter = xLast / 2;
      const zCenter = zLast / 2;
      const sceneWidth = Math.max(xLast + 2.8, 5);
      const sceneDepth = Math.max(zLast + 2.8, 4);
      const orbitRadius = Math.max(sceneWidth, sceneDepth, 6);
      const axisX = xLast + 0.28;
      const axisZ = zOrigin - 0.66;
      const xForIndex = (index: number) => xLast - index * xSpacing;
      const target = new THREE.Vector3(xCenter * 0.98, sceneHeight * 0.46, Math.max(zCenter * 0.72, 0.35));
      const startTarget = new THREE.Vector3(xCenter * 0.88, sceneHeight * 0.38, Math.max(zCenter * 0.58, 0.25));
      const startPosition = new THREE.Vector3(xCenter * 1.02, sceneHeight * 0.58, axisZ - orbitRadius * 1.18);
      const finalPosition = new THREE.Vector3(
        xCenter + orbitRadius * 0.62,
        sceneHeight * 0.68,
        axisZ - orbitRadius * 0.82,
      );

      controls.target.copy(target);
      controls.minDistance = Math.max(3.8, orbitRadius * 0.55);
      controls.maxDistance = orbitRadius * 2.3;

      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      camera.position.copy(reducedMotion ? finalPosition : startPosition);
      camera.lookAt(reducedMotion ? target : startTarget);
      controls.enabled = reducedMotion;

      scene.add(new THREE.AmbientLight(0xffffff, theme === 'dark' ? 0.78 : 0.92));

      const hemisphere = new THREE.HemisphereLight(0xdfefff, 0x3c2d21, theme === 'dark' ? 1.1 : 0.95);
      scene.add(hemisphere);

      const directionalLight = new THREE.DirectionalLight(0xffffff, theme === 'dark' ? 1.55 : 1.35);
      directionalLight.position.set(-4.5, 8, 5.5);
      directionalLight.castShadow = true;
      directionalLight.shadow.mapSize.set(2048, 2048);
      directionalLight.shadow.camera.near = 0.5;
      directionalLight.shadow.camera.far = 30;
      directionalLight.shadow.camera.left = -9;
      directionalLight.shadow.camera.right = 9;
      directionalLight.shadow.camera.top = 9;
      directionalLight.shadow.camera.bottom = -9;
      scene.add(directionalLight);

      const warmLight = new THREE.PointLight(colors.warmLight, theme === 'dark' ? 1.0 : 0.75, 18);
      warmLight.position.set(axisX + sceneWidth * 0.22, sceneHeight * 1.45, axisZ - sceneDepth * 0.24);
      scene.add(warmLight);

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(sceneWidth + 1.2, sceneDepth + 1.8),
        new THREE.MeshStandardMaterial({
          color: colors.ground,
          metalness: 0.02,
          roughness: 0.72,
          transparent: true,
          opacity: theme === 'dark' ? 0.72 : 0.86,
        }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(xCenter, -0.02, zCenter);
      ground.receiveShadow = true;
      scene.add(ground);

      const grid = new THREE.GridHelper(Math.max(sceneWidth, sceneDepth) + 1.2, 18, colors.grid, colors.grid);
      grid.position.set(xCenter, 0.004, zCenter);
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = theme === 'dark' ? 0.16 : 0.2;
      scene.add(grid);

      const bars: BarMeshState[] = [];
      const yScale = sceneHeight / sceneData.axisMaxLuminance;

      for (const datum of sceneData.bars) {
        const x = xForIndex(datum.xIndex);
        const z = zOrigin + datum.zIndex * zSpacing;
        const targetHeight = Math.max(datum.meanLuminance * yScale, 0.035);
        const material = new THREE.MeshStandardMaterial({
          color: colors.bar,
          roughness: 0.38,
          metalness: 0.06,
          transparent: true,
          opacity: theme === 'dark' ? 0.88 : 0.94,
        });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(barWidth, 1, barDepth), material);
        mesh.position.set(x, targetHeight / 2, z);
        mesh.scale.y = reducedMotion ? targetHeight : 0.001;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.datum = datum;
        scene.add(mesh);

        const cap = new THREE.Mesh(
          new THREE.BoxGeometry(barWidth * 1.03, 0.018, barDepth * 1.03),
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(datum.curveColor),
            transparent: true,
            opacity: theme === 'dark' ? 0.72 : 0.62,
          }),
        );
        cap.position.set(x, reducedMotion ? targetHeight + 0.018 : 0.018, z);
        cap.visible = reducedMotion;
        scene.add(cap);

        const edge = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(barWidth, 1, barDepth)),
          new THREE.LineBasicMaterial({
            color: new THREE.Color(datum.curveColor),
            transparent: true,
            opacity: theme === 'dark' ? 0.28 : 0.2,
          }),
        );
        mesh.add(edge);

        bars.push({
          mesh,
          cap,
          datum,
          targetHeight,
          xIndex: datum.xIndex,
          zIndex: datum.zIndex,
        });
      }

      const labelColor = colors.muted;
      for (const level of sceneData.levels) {
        const x = xForIndex(sceneData.levels.indexOf(level));
        const label = makeTextSprite(`${level}%`, { color: labelColor, fontSize: 34, width: 128, height: 52 });
        label.position.set(x, 0.13, axisZ - 0.18);
        label.scale.set(0.54, 0.22, 1);
        scene.add(label);
      }

      for (const [index, curve] of sceneData.curves.entries()) {
        const label = makeTextSprite(truncateLabel(curve.name.replace(/\.xlsx$/i, ''), 16), {
          color: colors.text,
          fontSize: 32,
          width: 340,
          height: 58,
          weight: 760,
        });
        label.position.set(axisX - 0.12, 0.34, zOrigin + index * zSpacing);
        label.scale.set(1.42, 0.24, 1);
        scene.add(label);
      }

      const axisMaterial = new THREE.LineBasicMaterial({ color: colors.axis, transparent: true, opacity: 0.72 });
      const xAxisLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(axisX, 0.03, axisZ),
          new THREE.Vector3(xOrigin - 0.56, 0.03, axisZ),
        ]),
        axisMaterial.clone(),
      );
      scene.add(xAxisLine);
      const zAxisLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(axisX, 0.03, axisZ),
          new THREE.Vector3(axisX, 0.03, zLast + 0.56),
        ]),
        axisMaterial.clone(),
      );
      scene.add(zAxisLine);
      const axisLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(axisX, 0, axisZ),
          new THREE.Vector3(axisX, sceneHeight, axisZ),
        ]),
        axisMaterial,
      );
      scene.add(axisLine);

      const tickMaterial = new THREE.LineBasicMaterial({ color: colors.axis, transparent: true, opacity: 0.52 });
      const tickRatios = [0, 0.25, 0.5, 0.75, 1];
      for (const ratio of tickRatios) {
        const y = ratio * sceneHeight;
        const tick = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(axisX - 0.08, y, axisZ),
            new THREE.Vector3(axisX + 0.12, y, axisZ),
          ]),
          tickMaterial.clone(),
        );
        scene.add(tick);

        const label = makeTextSprite(formatNumber(sceneData.axisMaxLuminance * ratio, 0), {
          color: labelColor,
          fontSize: 27,
          width: 112,
          height: 46,
            weight: 650,
        });
        label.position.set(axisX + 0.3, y, axisZ);
        label.scale.set(0.44, 0.18, 1);
        scene.add(label);
      }

      const axisLabel = makeTextSprite('亮度 / nits', {
        color: colors.text,
        fontSize: 28,
        width: 160,
        height: 52,
      });
      axisLabel.position.set(axisX + 0.18, sceneHeight + 0.32, axisZ);
      axisLabel.scale.set(0.62, 0.2, 1);
      scene.add(axisLabel);

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      const hoveredMeshRef: { current: BarMeshState | null } = { current: null };

      const setHoveredMesh = (next: BarMeshState | null) => {
        if (hoveredMeshRef.current === next) return;
        if (hoveredMeshRef.current) {
          hoveredMeshRef.current.mesh.material.emissive.setHex(0x000000);
          hoveredMeshRef.current.mesh.material.emissiveIntensity = 0;
        }
        hoveredMeshRef.current = next;
        if (next) {
          next.mesh.material.emissive = new THREE.Color(next.datum.curveColor);
          next.mesh.material.emissiveIntensity = 0.2;
        }
      };

      const handlePointerMove = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(bars.map((bar) => bar.mesh), false)[0];

        if (!hit) {
          setHoveredMesh(null);
          setTooltip(null);
          return;
        }

        const bar = bars.find((candidate) => candidate.mesh === hit.object);
        if (!bar) return;
        setHoveredMesh(bar);
        setTooltip({
          x: event.clientX - rect.left + 14,
          y: event.clientY - rect.top + 14,
          datum: bar.datum,
        });
      };

      const handlePointerLeave = () => {
        setHoveredMesh(null);
        setTooltip(null);
      };

      renderer.domElement.addEventListener('pointermove', handlePointerMove);
      renderer.domElement.addEventListener('pointerleave', handlePointerLeave);

      const setSize = () => {
        const rect = container.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      setSize();

      const resizeObserver = new ResizeObserver(setSize);
      resizeObserver.observe(container);

      let animationFrame = 0;
      let introComplete = reducedMotion;
      const startedAt = performance.now();
      if (reducedMotion) {
        for (const bar of bars) {
          bar.mesh.scale.y = bar.targetHeight;
          bar.mesh.position.y = bar.targetHeight / 2;
          bar.cap.position.y = bar.targetHeight + 0.018;
          bar.cap.visible = true;
        }
      }

      const renderFrame = (now: number) => {
        if (!introComplete) {
          const elapsed = now - startedAt;
          const cameraProgress = easeOutCubic(clamp01(elapsed / 1450));
          const cameraTarget = startTarget.clone().lerp(target, cameraProgress);
          camera.position.copy(startPosition.clone().lerp(finalPosition, cameraProgress));
          camera.lookAt(cameraTarget);
          controls.target.copy(cameraTarget);

          for (const bar of bars) {
            const stagger = bar.xIndex * 36 + bar.zIndex * 24;
            const progress = easeOutCubic(clamp01((elapsed - stagger) / 760));
            const height = Math.max(bar.targetHeight * progress, 0.001);
            bar.mesh.scale.y = height;
            bar.mesh.position.y = height / 2;
            bar.cap.position.y = height + 0.018;
            bar.cap.visible = progress > 0.04;
          }

          if (cameraProgress >= 1 && elapsed > 1200) {
            introComplete = true;
            controls.enabled = true;
            controls.target.copy(target);
          }
        }

        controls.update();
        renderer.render(scene, camera);
        animationFrame = window.requestAnimationFrame(renderFrame);
      };
      animationFrame = window.requestAnimationFrame(renderFrame);

      return () => {
        window.cancelAnimationFrame(animationFrame);
        resizeObserver.disconnect();
        renderer.domElement.removeEventListener('pointermove', handlePointerMove);
        renderer.domElement.removeEventListener('pointerleave', handlePointerLeave);
        controls.dispose();
        disposeScene(scene);
        renderer.dispose();
        renderer.domElement.remove();
        rendererRef.current = null;
        setTooltip(null);
      };
    }, [sceneData, theme]);

    return (
      <div className={`luminance-scene3d ${theme}`} aria-label="3D 亮度柱阵">
        <div className="scene3d-viewport" ref={containerRef} />
        {sceneData.bars.length === 0 ? (
          <div className="scene3d-empty">
            <strong>没有 3D 数据</strong>
            <span>后处理需要至少一个稳定窗口。</span>
          </div>
        ) : null}
        {tooltip ? (
          <div className="scene3d-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
            <strong>{tooltip.datum.curveName}</strong>
            <span>{formatNumber(tooltip.datum.levelPercent, 2)}% window</span>
            <span>均值 {formatNumber(tooltip.datum.meanLuminance, 2)} nits</span>
            <span>中位 {formatNumber(tooltip.datum.medianLuminance, 2)} nits</span>
            <span>
              范围 {formatNumber(tooltip.datum.minLuminance, 2)} - {formatNumber(tooltip.datum.maxLuminance, 2)} nits
            </span>
          </div>
        ) : null}
      </div>
    );
  },
);

LuminanceScene3D.displayName = 'LuminanceScene3D';
