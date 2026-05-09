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

interface BarInstanceState {
  datum: LuminanceBar3DDatum;
  x: number;
  z: number;
  targetHeight: number;
  baseColor: THREE.Color;
  highlightColor: THREE.Color;
  xIndex: number;
  zIndex: number;
}

interface TooltipState {
  x: number;
  y: number;
  datum: LuminanceBar3DDatum;
}

const barDepth = 0.52;
const zSpacing = 0.98;
const sceneHeight = 4.8;
const minTimeBarWidth = 0.018;
const maxTimeBarWidth = 0.18;

const easeOutCubic = (value: number) => 1 - (1 - value) ** 3;
const easeInOutCubic = (value: number) => {
  const clampedValue = clamp01(value);
  return clampedValue < 0.5 ? 4 * clampedValue ** 3 : 1 - (-2 * clampedValue + 2) ** 3 / 2;
};
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (start: number, end: number, progress: number) => start + (end - start) * clamp01(progress);
const mixVector = (start: THREE.Vector3, end: THREE.Vector3, progress: number) =>
  start.clone().lerp(end, clamp01(progress));

const truncateLabel = (value: string, maxLength: number) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;

const getTimeBarWidth = (bars: LuminanceBar3DDatum[], xSpan: number, maxIndex: number) => {
  const uniqueIndices = Array.from(new Set(bars.map((bar) => bar.alignedIndex))).sort((a, b) => a - b);
  if (uniqueIndices.length < 2 || maxIndex <= 0) {
    return Math.max(minTimeBarWidth, Math.min(maxTimeBarWidth, xSpan * 0.08));
  }

  const minStep = uniqueIndices
    .slice(1)
    .reduce((minimum, value, index) => Math.min(minimum, value - uniqueIndices[index]), Number.POSITIVE_INFINITY);
  const worldStep = (minStep / maxIndex) * xSpan;

  return Math.max(minTimeBarWidth, Math.min(maxTimeBarWidth, worldStep * 0.68));
};

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
      renderer.shadowMap.type = THREE.PCFShadowMap;
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
      const indexSpan = Math.max(sceneData.maxAlignedIndex, 0.001);
      const xLast = Math.max(5.8, Math.min(16, sceneData.windows.length * 1.12 + 1.8));
      const zLast = zOrigin + Math.max(sceneData.curves.length - 1, 0) * zSpacing;
      const xCenter = xLast / 2;
      const zCenter = zLast / 2;
      const sceneWidth = Math.max(xLast + 2.8, 5);
      const sceneDepth = Math.max(zLast + 2.8, 4);
      const orbitRadius = Math.max(sceneWidth, sceneDepth, 6);
      const axisX = xLast + 0.28;
      const axisZ = zOrigin - 0.66;
      const xForIndex = (value: number) => xLast - (Math.max(0, Math.min(indexSpan, value)) / indexSpan) * xLast;
      const timeBarWidth = getTimeBarWidth(sceneData.bars, xLast, indexSpan);
      const target = new THREE.Vector3(xCenter * 0.98, sceneHeight * 0.46, Math.max(zCenter * 0.72, 0.35));
      const frame1Target = new THREE.Vector3(xCenter * 0.96, sceneHeight * 0.43, zOrigin + 0.04);
      const frame1Position = new THREE.Vector3(xCenter * 0.96, sceneHeight * 0.44, axisZ - orbitRadius * 1.08);
      const frame3Target = new THREE.Vector3(xCenter * 0.94, sceneHeight * 0.42, Math.max(zCenter * 0.18, 0.12));
      const frame3Position = new THREE.Vector3(
        xCenter + orbitRadius * 0.08,
        sceneHeight * 0.48,
        axisZ - orbitRadius * 1.12,
      );
      const revealPosition = new THREE.Vector3(
        xCenter + orbitRadius * 0.24,
        sceneHeight * 0.56,
        axisZ - orbitRadius * 1.08,
      );
      const revealTarget = new THREE.Vector3(xCenter * 0.94, sceneHeight * 0.43, Math.max(zCenter * 0.42, 0.22));
      const finalPosition = new THREE.Vector3(
        xCenter + orbitRadius * 0.66,
        sceneHeight * 0.74,
        axisZ - orbitRadius * 0.74,
      );

      controls.target.copy(target);
      controls.minDistance = Math.max(3.8, orbitRadius * 0.55);
      controls.maxDistance = orbitRadius * 2.3;

      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      const finalFov = 36;
      const frame1Fov = 30;
      const frame3Fov = 31;
      const revealFov = 33;
      camera.fov = reducedMotion ? finalFov : frame1Fov;
      camera.updateProjectionMatrix();
      camera.position.copy(reducedMotion ? finalPosition : frame1Position);
      camera.lookAt(reducedMotion ? target : frame1Target);
      controls.enabled = reducedMotion;

      scene.add(new THREE.AmbientLight(0xffffff, theme === 'dark' ? 0.78 : 0.92));

      const hemisphere = new THREE.HemisphereLight(0xdfefff, 0x3c2d21, theme === 'dark' ? 1.1 : 0.95);
      scene.add(hemisphere);

      const viewDirection = target.clone().sub(finalPosition).normalize();
      const screenRight = viewDirection.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
      const screenUp = screenRight.clone().cross(viewDirection).normalize();
      const daylightPosition = target
        .clone()
        .add(screenRight.clone().multiplyScalar(-sceneWidth * 0.95))
        .add(screenUp.clone().multiplyScalar(sceneHeight * 2.1));
      const daylightTarget = new THREE.Object3D();
      daylightTarget.position.set(xCenter, 0, zCenter);
      scene.add(daylightTarget);

      const directionalLight = new THREE.DirectionalLight(0xffffff, theme === 'dark' ? 1.55 : 1.35);
      directionalLight.position.copy(daylightPosition);
      directionalLight.target = daylightTarget;
      directionalLight.castShadow = true;
      directionalLight.shadow.mapSize.set(2048, 2048);
      directionalLight.shadow.camera.near = 0.1;
      directionalLight.shadow.camera.far = Math.max(48, orbitRadius * 4.2);
      directionalLight.shadow.camera.left = -sceneWidth * 1.6;
      directionalLight.shadow.camera.right = sceneWidth * 1.6;
      directionalLight.shadow.camera.top = Math.max(sceneHeight * 2.4, sceneDepth * 1.8);
      directionalLight.shadow.camera.bottom = -Math.max(sceneHeight * 1.4, sceneDepth * 1.8);
      directionalLight.shadow.bias = -0.0002;
      directionalLight.shadow.normalBias = 0.018;
      directionalLight.shadow.camera.updateProjectionMatrix();
      scene.add(directionalLight);

      const warmLight = new THREE.PointLight(colors.warmLight, theme === 'dark' ? 1.0 : 0.75, 18);
      warmLight.position.copy(daylightPosition).add(new THREE.Vector3(0, sceneHeight * 0.22, 0));
      scene.add(warmLight);

      const groundTargetOpacity = theme === 'dark' ? 0.72 : 0.86;
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(sceneWidth + 3.6, sceneDepth + 3.8),
        new THREE.MeshStandardMaterial({
          color: colors.ground,
          metalness: 0.02,
          roughness: 0.72,
          transparent: true,
          opacity: reducedMotion ? groundTargetOpacity : 0.02,
        }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(xCenter, -0.02, zCenter - 0.18);
      ground.receiveShadow = true;
      scene.add(ground);

      const grid = new THREE.GridHelper(Math.max(sceneWidth, sceneDepth) + 1.2, 18, colors.grid, colors.grid);
      grid.position.set(xCenter, 0.004, zCenter);
      const gridTargetOpacity = theme === 'dark' ? 0.16 : 0.2;
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = reducedMotion ? gridTargetOpacity : 0;
      scene.add(grid);

      const bars: BarInstanceState[] = [];
      const yScale = sceneHeight / sceneData.axisMaxLuminance;
      const barCount = sceneData.bars.length;

      const barGeometry = new THREE.BoxGeometry(timeBarWidth, 1, barDepth);
      const barMaterial = new THREE.MeshStandardMaterial({
        color: colors.bar,
        roughness: 0.38,
        metalness: 0.06,
      });
      const barInstances = new THREE.InstancedMesh(barGeometry, barMaterial, barCount);
      barInstances.castShadow = true;
      barInstances.receiveShadow = true;
      barInstances.frustumCulled = false;
      barInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const barColors = new Float32Array(barCount * 3);
      const barInstanceColor = new THREE.InstancedBufferAttribute(barColors, 3);
      barInstanceColor.setUsage(THREE.DynamicDrawUsage);
      barInstances.instanceColor = barInstanceColor;
      scene.add(barInstances);

      const capGeometry = new THREE.BoxGeometry(timeBarWidth * 1.03, 0.018, barDepth * 1.03);
      const capMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: theme === 'dark' ? 0.72 : 0.62,
      });
      const capInstances = new THREE.InstancedMesh(capGeometry, capMaterial, barCount);
      capInstances.frustumCulled = false;
      capInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const capColors = new Float32Array(barCount * 3);
      capInstances.instanceColor = new THREE.InstancedBufferAttribute(capColors, 3);
      scene.add(capInstances);

      const baseTint = new THREE.Color(1, 1, 1);

      for (let index = 0; index < barCount; index += 1) {
        const datum = sceneData.bars[index];
        const x = xForIndex(datum.alignedIndex);
        const z = zOrigin + datum.zIndex * zSpacing;
        const targetHeight = Math.max(datum.luminanceNits * yScale, 0.035);
        const curveColor = new THREE.Color(datum.curveColor);
        const highlightColor = curveColor.clone().lerp(new THREE.Color(1, 1, 1), 0.4);

        bars.push({
          datum,
          x,
          z,
          targetHeight,
          baseColor: baseTint.clone(),
          highlightColor,
          xIndex: datum.xIndex,
          zIndex: datum.zIndex,
        });

        barInstances.setColorAt(index, baseTint);
        capInstances.setColorAt(index, curveColor);
      }
      barInstanceColor.needsUpdate = true;
      if (capInstances.instanceColor) capInstances.instanceColor.needsUpdate = true;

      const labelColor = colors.muted;

      const boundaryMaterial = new THREE.LineBasicMaterial({
        color: colors.axis,
        transparent: true,
        opacity: theme === 'dark' ? 0.24 : 0.18,
      });
      const boundaryIndices = Array.from(
        new Set(sceneData.windows.flatMap((window) => [window.alignedIndexStart, window.alignedIndexEnd])),
      ).sort((a, b) => a - b);
      for (const indexValue of boundaryIndices) {
        const x = xForIndex(indexValue);
        const boundary = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(x, 0.036, axisZ + 0.16),
            new THREE.Vector3(x, 0.036, zLast + 0.5),
          ]),
          boundaryMaterial.clone(),
        );
        scene.add(boundary);
      }

      for (const window of sceneData.windows) {
        const x = xForIndex((window.alignedIndexStart + window.alignedIndexEnd) / 2);
        const label = makeTextSprite(`${window.windowLevel}%`, { color: labelColor, fontSize: 27, width: 120, height: 48 });
        label.position.set(x, 0.34, axisZ - 0.52);
        label.scale.set(0.46, 0.18, 1);
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
      let hoveredIndex = -1;

      const setHoveredIndex = (next: number) => {
        if (hoveredIndex === next) return;
        if (hoveredIndex >= 0 && hoveredIndex < bars.length) {
          barInstances.setColorAt(hoveredIndex, bars[hoveredIndex].baseColor);
        }
        hoveredIndex = next;
        if (next >= 0 && next < bars.length) {
          barInstances.setColorAt(next, bars[next].highlightColor);
        }
        if (barInstances.instanceColor) barInstances.instanceColor.needsUpdate = true;
      };

      const handlePointerMove = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObject(barInstances, false)[0];
        const instanceId = hit?.instanceId;

        if (instanceId === undefined || instanceId < 0 || instanceId >= bars.length) {
          setHoveredIndex(-1);
          setTooltip(null);
          return;
        }

        const bar = bars[instanceId];
        setHoveredIndex(instanceId);
        setTooltip({
          x: event.clientX - rect.left + 14,
          y: event.clientY - rect.top + 14,
          datum: bar.datum,
        });
      };

      const handlePointerLeave = () => {
        setHoveredIndex(-1);
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
      const introHoldMs = 240;
      const cameraPathMs = 1240;
      const frame3Ratio = 0.46;
      const revealStartMs = introHoldMs + cameraPathMs * 0.72;
      const rowDelayMs = 340;
      const timeSweepMs = 720;
      const barRiseMs = 620;
      const finalSettleMs = 520;
      const lastRowIndex = Math.max(...bars.map((bar) => bar.zIndex), 0);
      const hasAnimatedRows = lastRowIndex > 0;
      const lastAnimatedRowOffset = Math.max(lastRowIndex - 1, 0);
      const introDurationMs = hasAnimatedRows
        ? revealStartMs + lastAnimatedRowOffset * rowDelayMs + timeSweepMs + barRiseMs + finalSettleMs
        : cameraPathMs + finalSettleMs;

      const barMatrix = new THREE.Matrix4();
      const capMatrix = new THREE.Matrix4();
      const tmpScale = new THREE.Vector3();
      const tmpPosition = new THREE.Vector3();
      const tmpQuat = new THREE.Quaternion();

      const writeBarTransform = (index: number, height: number) => {
        const bar = bars[index];
        const safeHeight = Math.max(height, 0.0001);
        tmpScale.set(1, safeHeight, 1);
        tmpPosition.set(bar.x, safeHeight / 2, bar.z);
        barMatrix.compose(tmpPosition, tmpQuat, tmpScale);
        barInstances.setMatrixAt(index, barMatrix);

        tmpScale.set(1, 1, 1);
        tmpPosition.set(bar.x, height + 0.018, bar.z);
        capMatrix.compose(tmpPosition, tmpQuat, tmpScale);
        capInstances.setMatrixAt(index, capMatrix);
      };

      if (reducedMotion) {
        for (let index = 0; index < bars.length; index += 1) {
          writeBarTransform(index, bars[index].targetHeight);
        }
        barInstances.instanceMatrix.needsUpdate = true;
        capInstances.instanceMatrix.needsUpdate = true;
      } else {
        // start invisible (height 0) — every bar will scale-grow during the intro
        for (let index = 0; index < bars.length; index += 1) {
          writeBarTransform(index, 0);
        }
        barInstances.instanceMatrix.needsUpdate = true;
        capInstances.instanceMatrix.needsUpdate = true;
      }

      const getCameraPathFrame = (progress: number) => {
        const clampedProgress = clamp01(progress);
        if (clampedProgress <= frame3Ratio) {
          const segmentProgress = easeInOutCubic(clampedProgress / frame3Ratio);
          return {
            position: mixVector(frame1Position, frame3Position, segmentProgress),
            target: mixVector(frame1Target, frame3Target, segmentProgress),
            fov: lerp(frame1Fov, frame3Fov, segmentProgress),
          };
        }

        const segmentProgress = easeInOutCubic((clampedProgress - frame3Ratio) / (1 - frame3Ratio));
        return {
          position: mixVector(frame3Position, revealPosition, segmentProgress),
          target: mixVector(frame3Target, revealTarget, segmentProgress),
          fov: lerp(frame3Fov, revealFov, segmentProgress),
        };
      };

      const renderFrame = (now: number) => {
        if (!introComplete) {
          const elapsed = now - startedAt;
          const motionElapsed = Math.max(0, elapsed - introHoldMs);
          const pathFrame = getCameraPathFrame(motionElapsed / cameraPathMs);
          const settleProgress = easeOutCubic(clamp01((elapsed - revealStartMs) / (introDurationMs - revealStartMs)));
          const frontRowProgress = easeOutCubic(
            clamp01((elapsed - introHoldMs - cameraPathMs * 0.58) / (revealStartMs - introHoldMs - cameraPathMs * 0.58)),
          );
          const worldProgress = easeOutCubic(
            clamp01((elapsed - introHoldMs - cameraPathMs * 0.44) / (revealStartMs - introHoldMs - cameraPathMs * 0.44)),
          );
          const cameraTarget = mixVector(pathFrame.target, target, settleProgress);
          camera.position.copy(mixVector(pathFrame.position, finalPosition, settleProgress));
          camera.fov = lerp(pathFrame.fov, finalFov, settleProgress);
          camera.updateProjectionMatrix();
          camera.lookAt(cameraTarget);
          controls.target.copy(cameraTarget);
          ground.material.opacity = lerp(0.02, groundTargetOpacity, worldProgress);
          (grid.material as THREE.Material).opacity = lerp(0, gridTargetOpacity, worldProgress);

          for (let index = 0; index < bars.length; index += 1) {
            const bar = bars[index];
            let progress: number;
            if (bar.zIndex === 0) {
              progress = frontRowProgress;
            } else {
              const timeRatio =
                sceneData.maxAlignedIndex > 0 ? clamp01(bar.datum.alignedIndex / sceneData.maxAlignedIndex) : 0;
              const stagger = revealStartMs + (bar.zIndex - 1) * rowDelayMs + timeRatio * timeSweepMs;
              progress = easeOutCubic(clamp01((elapsed - stagger) / barRiseMs));
            }
            const height = Math.max(bar.targetHeight * progress, 0.0001);
            writeBarTransform(index, height);
          }
          barInstances.instanceMatrix.needsUpdate = true;
          capInstances.instanceMatrix.needsUpdate = true;

          if (elapsed >= introDurationMs) {
            introComplete = true;
            controls.enabled = true;
            controls.target.copy(target);
            camera.position.copy(finalPosition);
            camera.fov = finalFov;
            camera.updateProjectionMatrix();
            camera.lookAt(target);
            ground.material.opacity = groundTargetOpacity;
            (grid.material as THREE.Material).opacity = gridTargetOpacity;
            for (let index = 0; index < bars.length; index += 1) {
              writeBarTransform(index, bars[index].targetHeight);
            }
            barInstances.instanceMatrix.needsUpdate = true;
            capInstances.instanceMatrix.needsUpdate = true;
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
            <span>后处理需要至少一个稳定采样点。</span>
          </div>
        ) : null}
        {tooltip ? (
          <div className="scene3d-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
            <strong>{tooltip.datum.curveName}</strong>
            <span>{formatNumber(tooltip.datum.windowLevel, 2)}% window</span>
            <span>对齐位置 #{formatNumber(tooltip.datum.alignedIndex, 0)}</span>
            <span>窗口内 #{formatNumber(tooltip.datum.windowIndex, 0)}</span>
            <span>亮度 {formatNumber(tooltip.datum.luminanceNits, 2)} nits</span>
            <span>行 {tooltip.datum.rowNumber}</span>
          </div>
        ) : null}
      </div>
    );
  },
);

LuminanceScene3D.displayName = 'LuminanceScene3D';
