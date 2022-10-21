import * as THREE from 'https://cdn.skypack.dev/three@0.142.0';
import { EffectComposer } from 'https://unpkg.com/three@0.142.0/examples/jsm/postprocessing/EffectComposer.js';
import { FullScreenQuad } from 'https://unpkg.com/three@0.142.0/examples/jsm/postprocessing/Pass.js';
import { ShaderPass } from 'https://unpkg.com/three@0.142.0/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'https://unpkg.com/three@0.142.0/examples/jsm/postprocessing/SMAAPass.js';
import { GammaCorrectionShader } from 'https://unpkg.com/three@0.142.0/examples/jsm/shaders/GammaCorrectionShader.js';
import { EffectShader } from "./EffectShader.js";
import { OrbitControls } from 'https://unpkg.com/three@0.142.0/examples/jsm/controls/OrbitControls.js';
import { TeapotGeometry } from 'https://unpkg.com/three@0.142.0/examples/jsm/geometries/TeapotGeometry.js';
import * as BufferGeometryUtils from 'https://unpkg.com/three@0.142.0/examples/jsm/utils/BufferGeometryUtils.js';
import * as MeshBVHLib from 'https://unpkg.com/three-mesh-bvh@0.5.10/build/index.module.js';
import {
    GLTFLoader
} from 'https://unpkg.com/three@0.142.0/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'https://unpkg.com/three@0.142.0/examples/jsm/libs/meshopt_decoder.module.js';
import { DRACOLoader } from 'https://unpkg.com/three@0.142.0/examples/jsm/loaders/DRACOLoader.js';
import {
    MeshBVH,
    MeshBVHVisualizer,
    MeshBVHUniformStruct,
    FloatVertexAttributeTexture,
    shaderStructs,
    shaderIntersectFunction,
    SAH
} from 'https://unpkg.com/three-mesh-bvh@0.5.10/build/index.module.js';
import { AssetManager } from './AssetManager.js';
import { GUI } from 'https://unpkg.com/three@0.142.0/examples/jsm/libs/lil-gui.module.min.js';
import { Stats } from "./stats.js";
const makeSDFTexture = (bvh, box, resolution = 1.0) => {
    const xSize = Math.floor((box.max.x - box.min.x) * resolution);
    const ySize = Math.floor((box.max.y - box.min.y) * resolution);
    const zSize = Math.floor((box.max.z - box.min.z) * resolution);
    const volumeData = new Float32Array(xSize * ySize * zSize);
    for (let z = box.min.z; z < box.max.z; z += (1 / resolution)) {
        for (let y = box.min.y; y < box.max.y; y += (1 / resolution)) {
            for (let x = box.min.x; x < box.max.x; x += (1 / resolution)) {
                let distance = bvh.closestPointToPoint(new THREE.Vector3(x, y, z)).distance;
                /*const direction = new THREE.Vector3(1.0, 1.0, 1.0).normalize();
                const hit = bvh.raycastFirst(new THREE.Ray(new THREE.Vector3(x, y, z), direction), THREE.DoubleSide);
                const direction2 = direction.clone().multiplyScalar(-1);
                const hit2 = bvh.raycastFirst(new THREE.Ray(new THREE.Vector3(x, y, z), direction2), THREE.DoubleSide);
                //console.log(hits);
                if (hit && hit2) {
                    distance *= hit.face.normal.dot(direction) >= 0 || hit2.face.normal.dot(direction2) >= 0 ? -1 : 1;
                }*/
                let insideResults = 0;
                for (let i = 0; i < 20; i++) {
                    let direction = new THREE.Vector3(1, 1, 1);
                    direction.random().subScalar(0.5).normalize();
                    let hits = bvh.raycast(new THREE.Ray(new THREE.Vector3(x, y, z), direction), THREE.DoubleSide);
                    if (hits.length % 2 === 1) {
                        if (hits[0].face.normal.dot(direction) > 0.0) {
                            insideResults++;
                        }
                    }
                    direction.multiplyScalar(-1);
                    hits = bvh.raycast(new THREE.Ray(new THREE.Vector3(x, y, z), direction), THREE.DoubleSide);
                    if (hits.length % 2 === 1) {
                        if (hits[0].face.normal.dot(direction) > 0.0) {
                            insideResults++;
                        }
                    }
                }
                if (insideResults > 12) {
                    distance *= -1;
                }
                /* if (distance < 0) {
                     const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: new THREE.Color(1.0, 1.0, 1.0) }));
                     mesh.position.x = x;
                     mesh.position.y = y;
                     mesh.position.z = z;
                     mesh.castShadow = true;
                     mesh.receiveShadow = true;
                     scene.add(mesh);
                 }*/
                volumeData[Math.floor((z - box.min.z) * resolution * (ySize * xSize) + (y - box.min.y) * resolution * (xSize) + resolution * (x - box.min.x))] = distance;
            }
        }
    }
    const texture = new THREE.Data3DTexture(volumeData, xSize, ySize, zSize);
    texture.format = THREE.RedFormat;
    texture.type = THREE.FloatType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
}
const makeSDFTextureGPU = (bvh, box, resolution, renderer, mesh) => {
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight())
    const oldParent = mesh.parent;
    const oldVis = mesh.visible;
    mesh.visible = true;
    scene.attach(mesh);
    const xSize = Math.floor((box.max.x - box.min.x) * resolution);
    const ySize = Math.floor((box.max.y - box.min.y) * resolution);
    const zSize = Math.floor((box.max.z - box.min.z) * resolution);
    console.log(xSize, ySize, zSize);

    const volumeData = new Float32Array(xSize * ySize * zSize);
    const positions = [];
    for (let z = box.min.z; z < box.max.z; z += (1 / resolution)) {
        for (let y = box.min.y; y < box.max.y; y += (1 / resolution)) {
            for (let x = box.min.x; x < box.max.x; x += (1 / resolution)) {
                positions.push(x, y, z, 1.0);
            }
        }
    }
    const textureSize = Math.ceil(Math.sqrt(positions.length / 4));
    while ((positions.length / 4) < textureSize * textureSize) {
        positions.push(0.0, 0.0, 0.0, 0.0);
    }
    const texArr = new Float32Array(positions.length);
    for (let i = 0; i < texArr.length; i++) {
        texArr[i] = positions[i];
    }
    const texture = new THREE.DataTexture(texArr, textureSize, textureSize);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.FloatType;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    const renderTarget = new THREE.WebGLRenderTarget(textureSize, textureSize, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        type: THREE.FloatType
    });
    const quadRender = new FullScreenQuad(new THREE.ShaderMaterial({
        uniforms: {
            'bvh': { value: new MeshBVHUniformStruct() },
            'points': { value: texture },
            'radius': { value: 0.5 / resolution }
        },
        vertexShader: /*glsl*/ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}`,
        fragmentShader: /*glsl*/ `
        precision highp isampler2D;
        precision highp usampler2D;
        uniform sampler2D points;
        uniform float radius;
        varying vec2 vUv;
        ${ shaderStructs }
        ${ shaderIntersectFunction }
        uniform BVH bvh;
        float dot2( in vec3 v ) { return dot(v,v); }
        float distSquared(vec3 a, vec3 b) {
            vec3 c = a - b;
            return dot(c, c);
        }
        float udTriangle( vec3 p, vec3 a, vec3 b, vec3 c )
        {
        vec3 ba = b - a; vec3 pa = p - a;
        vec3 cb = c - b; vec3 pb = p - b;
        vec3 ac = a - c; vec3 pc = p - c;
        vec3 nor = cross( ba, ac );

        return 
            (sign(dot(cross(ba,nor),pa)) +
            sign(dot(cross(cb,nor),pb)) +
            sign(dot(cross(ac,nor),pc))<2.0)
            ?
            min( min(
            dot2(ba*clamp(dot(ba,pa)/dot2(ba),0.0,1.0)-pa),
            dot2(cb*clamp(dot(cb,pb)/dot2(cb),0.0,1.0)-pb) ),
            dot2(ac*clamp(dot(ac,pc)/dot2(ac),0.0,1.0)-pc) )
            :
            dot(nor,pa)*dot(nor,pa)/dot2(nor);
        }
        float intersectTrianglesPoint(
            BVH bvh, vec3 point, uint offset, uint count, float closestDistanceSquared
        ) {
            bool found = false;
            for ( uint i = offset, l = offset + count; i < l; i ++ ) {
                uvec3 indices = uTexelFetch1D( bvh.index, i ).xyz;
                vec3 a = texelFetch1D( bvh.position, indices.x ).rgb;
                vec3 b = texelFetch1D( bvh.position, indices.y ).rgb;
                vec3 c = texelFetch1D( bvh.position, indices.z ).rgb;
                float dist = udTriangle(point, a, b, c);
                if (
                   dist < closestDistanceSquared
                ) {
                    closestDistanceSquared = dist;
                }
            }
            return closestDistanceSquared;
        }
        
        float intersectsBVHNodeBoundsPoint( vec3 point, BVH bvh, uint currNodeIndex ) {
            vec3 boundsMin = texelFetch1D( bvh.bvhBounds, currNodeIndex * 2u + 0u ).xyz;
            vec3 boundsMax = texelFetch1D( bvh.bvhBounds, currNodeIndex * 2u + 1u ).xyz;
            vec3 clampedPoint = clamp(point, boundsMin, boundsMax);

            return distSquared(point, clampedPoint);
        }
        float bvhClosestPointToPoint(
            BVH bvh, vec3 point
        ) {
            // stack needs to be twice as long as the deepest tree we expect because
            // we push both the left and right child onto the stack every traversal
            int ptr = 0;
            uint stack[ 60 ];
            stack[ 0 ] = 0u;
            float closestDistanceSquared = 10000.0 * 10000.0;
            bool found = false;
            while ( ptr > - 1 && ptr < 60 ) {
                uint currNodeIndex = stack[ ptr ];
                ptr --;
                // check if we intersect the current bounds
                float boundsHitDistance = intersectsBVHNodeBoundsPoint( point, bvh, currNodeIndex );
                if ( boundsHitDistance > closestDistanceSquared ) {
                    continue;
                }
                uvec2 boundsInfo = uTexelFetch1D( bvh.bvhContents, currNodeIndex ).xy;
                bool isLeaf = bool( boundsInfo.x & 0xffff0000u );
                if ( isLeaf ) {
                    uint count = boundsInfo.x & 0x0000ffffu;
                    uint offset = boundsInfo.y;
                    closestDistanceSquared = intersectTrianglesPoint(
                        bvh, point, offset, count, closestDistanceSquared
                    );
                } else {
                    uint leftIndex = currNodeIndex + 1u;
                    uint splitAxis = boundsInfo.x & 0x0000ffffu;
                    uint rightIndex = boundsInfo.y;
                    bool leftToRight = intersectsBVHNodeBoundsPoint( point, bvh, leftIndex ) < intersectsBVHNodeBoundsPoint( point, bvh, rightIndex );//rayDirection[ splitAxis ] >= 0.0;
                    uint c1 = leftToRight ? leftIndex : rightIndex;
                    uint c2 = leftToRight ? rightIndex : leftIndex;
                    // set c2 in the stack so we traverse it later. We need to keep track of a pointer in
                    // the stack while we traverse. The second pointer added is the one that will be
                    // traversed first
                    ptr ++;
                    stack[ ptr ] = c2;
                    ptr ++;
                    stack[ ptr ] = c1;
                }
            }
            return sqrt(closestDistanceSquared);
        }
        void main() {
            vec4 point = texture2D(points, vUv);
            if (point.w == 1.0) {
                gl_FragColor = vec4(bvhClosestPointToPoint(bvh, point.xyz) - radius, 0.0, 0.0, 0.0);
            } else {
                gl_FragColor = vec4(0.0);
            }
        }
        `
    }));
    quadRender.material.uniforms.bvh.value.updateFrom(bvh);
    renderer.setRenderTarget(renderTarget);
    quadRender.render(renderer);
    const res = new Float32Array(4 * textureSize * textureSize);
    renderer.readRenderTargetPixels(renderTarget, 0, 0, textureSize, textureSize, res);
    const finalDists = new Float32Array(positions.length / 4);
    //const geo = new THREE.SphereGeometry(0.5, 4, 4);
    //const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(1, 0, 0) });
    for (let i = 0; i < positions.length / 4; i++) {
        finalDists[i] = res[i * 4];
    }
    // const dists = Array.from(res).filter((_, i) => i % 4 === 0).slice(0, positions.length);
    const volumeTexture = new THREE.Data3DTexture(finalDists, xSize, ySize, zSize);
    volumeTexture.format = THREE.RedFormat;
    volumeTexture.type = THREE.FloatType;
    volumeTexture.minFilter = THREE.LinearFilter;
    volumeTexture.magFilter = THREE.LinearFilter;
    volumeTexture.unpackAlignment = 1;
    volumeTexture.needsUpdate = true;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const voxelCameraZ = new THREE.OrthographicCamera(-size.x / 2, size.x / 2, -size.y / 2, size.y / 2, 0.001, 1);
    voxelCameraZ.position.y = center.y;
    voxelCameraZ.position.x = center.x;
    voxelCameraZ.position.z = -size.z / 2 + 1 + center.z;
    voxelCameraZ.updateMatrixWorld();
    const voxelCameraX = new THREE.OrthographicCamera(-size.z / 2, size.z / 2, -size.y / 2, size.y / 2, 0.001, 1);
    voxelCameraX.position.x = -size.x / 2 + 1 + center.x;
    voxelCameraX.lookAt(0, 0, 0);
    voxelCameraX.position.y = center.y;
    voxelCameraX.position.z = center.z;
    voxelCameraX.updateMatrixWorld();
    const voxelCameraY = new THREE.OrthographicCamera(-size.x / 2, size.x / 2, -size.z / 2, size.z / 2, 0.001, 1);
    voxelCameraY.position.y = size.y / 2 + center.y;
    voxelCameraY.lookAt(0, 0, 0);
    voxelCameraZ.position.x = center.x;
    voxelCameraX.position.z = center.z;
    voxelCameraY.updateMatrixWorld();
    /*const chelper = new THREE.CameraHelper(voxelCameraX);
    scene.add(chelper);
    const chelper2 = new THREE.CameraHelper(voxelCameraY);
    scene.add(chelper2);
    const chelper3 = new THREE.CameraHelper(voxelCameraZ);
    scene.add(chelper3);*/
    const voxelRenderTargetZ = new THREE.WebGLRenderTarget(size.x * resolution, size.y * resolution, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        type: THREE.FloatType
    });
    const voxelRenderTargetX = new THREE.WebGLRenderTarget(size.z * resolution, size.y * resolution, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        type: THREE.FloatType
    });
    const voxelRenderTargetY = new THREE.WebGLRenderTarget(size.x * resolution, size.z * resolution, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        type: THREE.FloatType
    });
    let voxelList = [];
    let voxelMeshFinal = null;
    const bufferZ = new Float32Array(4 * size.x * size.y * resolution * resolution);
    const bufferX = new Float32Array(4 * size.z * size.y * resolution * resolution);
    const bufferY = new Float32Array(4 * size.x * size.z * resolution * resolution);
    const xOffset = new THREE.Vector3(0.5, 0.5, 0.5);
    const yOffset = new THREE.Vector3(0.5, 0.5, 0.5);
    const zOffset = new THREE.Vector3(0.5, 0.5, 0.5);
    while (!(voxelCameraX.position.x > size.x / 2 + center.x && voxelCameraY.position.y < -size.y / 2 + center.y && voxelCameraZ.position.z > size.z / 2 + center.z)) {
        if (voxelCameraZ.position.z <= size.z / 2 + center.z) {
            renderer.setRenderTarget(voxelRenderTargetZ);
            renderer.clear();
            renderer.render(scene, voxelCameraZ);
            renderer.readRenderTargetPixels(voxelRenderTargetZ, 0, 0, size.x * resolution, size.y * resolution, bufferZ);
            for (let y = 0; y < size.y * resolution; y++) {
                for (let x = 0; x < size.x * resolution; x++) {
                    if (bufferZ[(y * size.x * resolution + x) * 4] > 0 || bufferZ[(y * size.x * resolution + x) * 4 + 1] > 0 || bufferZ[(y * size.x * resolution + x) * 4 + 2] > 0) {
                        voxelList.push({
                            color: new THREE.Color(bufferZ[(y * size.x * resolution + x) * 4], bufferZ[(y * size.x * resolution + x) * 4 + 1], bufferZ[(y * size.x * resolution + x) * 4 + 2]),
                            position: new THREE.Vector3(x / resolution - size.x / 2 + center.x, -(y / resolution - size.y / 2) + center.y, voxelCameraZ.position.z).add(zOffset),
                            axis: "z"
                        });
                    }
                }
            }
            voxelCameraZ.position.z += 1.0 / resolution;
            voxelCameraZ.updateMatrixWorld();
        }
        if (voxelCameraX.position.x <= size.x / 2 + center.x) {
            renderer.setRenderTarget(voxelRenderTargetX);
            renderer.clear();
            renderer.render(scene, voxelCameraX);
            renderer.readRenderTargetPixels(voxelRenderTargetX, 0, 0, size.z * resolution, size.y * resolution, bufferX);
            for (let y = 0; y < size.y * resolution; y++) {
                for (let x = 0; x < size.z * resolution; x++) {
                    if (bufferX[(y * size.z * resolution + x) * 4] > 0 || bufferX[(y * size.z * resolution + x) * 4 + 1] > 0 || bufferX[(y * size.z * resolution + x) * 4 + 2] > 0) {
                        voxelList.push({
                            color: new THREE.Color(bufferX[(y * size.z * resolution + x) * 4], bufferX[(y * size.z * resolution + x) * 4 + 1], bufferX[(y * size.z * resolution + x) * 4 + 2]),
                            position: new THREE.Vector3(voxelCameraX.position.x, -(y / resolution - size.y / 2) + center.y, x / resolution - size.z / 2).add(xOffset),
                            axis: "x"
                        });
                    }
                }
            }
            voxelCameraX.position.x += 1.0 / resolution;
            voxelCameraX.updateMatrixWorld();
        }
        if (voxelCameraY.position.y >= -size.y / 2 + center.y) {
            renderer.clear();
            renderer.setRenderTarget(voxelRenderTargetY);
            renderer.render(scene, voxelCameraY);
            renderer.readRenderTargetPixels(voxelRenderTargetY, 0, 0, size.x * resolution, size.z * resolution, bufferY);
            for (let y = 0; y < size.z * resolution; y++) {
                for (let x = 0; x < size.x * resolution; x++) {
                    if (bufferY[(y * size.x * resolution + x) * 4] > 0 || bufferY[(y * size.x * resolution + x) * 4 + 1] > 0 || bufferY[(y * size.x * resolution + x) * 4 + 2] > 0) {
                        voxelList.push({
                            color: new THREE.Color(bufferY[(y * size.x * resolution + x) * 4], bufferY[(y * size.x * resolution + x) * 4 + 1], bufferY[(y * size.x * resolution + x) * 4 + 2]),
                            position: new THREE.Vector3(x / resolution - size.x / 2, voxelCameraY.position.y, y / resolution - size.z / 2).add(yOffset),
                            axis: "y"
                        });
                    }
                }
            }
            voxelCameraY.position.y -= 1.0 / resolution;
            voxelCameraY.updateMatrixWorld();
        }
    }
    /*voxelList.forEach(voxel => {
      
    })*/
    voxelMeshFinal = new THREE.InstancedMesh(new THREE.BoxGeometry(1 / resolution, 1 / resolution, 1 / resolution), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), voxelList.length);
    for (let i = 0; i < voxelList.length; i++) {
        voxelMeshFinal.setMatrixAt(i, new THREE.Matrix4().setPosition(...voxelList[i].position));
        voxelMeshFinal.setColorAt(i, voxelList[i].color);
    }
    scene.add(voxelMeshFinal);
    const voxelTexture = new THREE.WebGL3DRenderTarget(size.x * resolution, size.y * resolution, size.z * resolution); //new THREE.Data3DTexture(voxelTex, size.x, size.y, size.z);
    voxelTexture.texture.format = THREE.RGBAFormat;
    voxelTexture.texture.type = THREE.FloatType;
    voxelTexture.texture.minFilter = THREE.LinearFilter;
    voxelTexture.texture.magFilter = THREE.LinearFilter;
    voxelTexture.needsUpdate = true;
    voxelCameraZ.position.z = -size.z / 2 + 1 + center.z;
    voxelCameraZ.position.y = center.y;
    voxelCameraZ.position.x = center.x;
    voxelCameraZ.rotation.z = Math.PI;
    voxelCameraZ.rotation.y = Math.PI;
    voxelCameraZ.updateMatrixWorld();
    renderer.setClearAlpha(0);
    for (let i = 0; i < size.z * resolution; i++) {
        renderer.setRenderTarget(voxelTexture, i);
        renderer.render(scene, voxelCameraZ);
        voxelCameraZ.position.z += 1.0 / resolution;
    }
    voxelMeshFinal.visible = false;
    renderer.setClearAlpha(1);
    oldParent.attach(mesh);
    mesh.visible = oldVis;
    return [volumeTexture, voxelTexture.texture];

}
const makeSDFFromSource = (source) => {
    const texture = new THREE.Data3DTexture(new Float32Array(source.data), source.width, source.height, source.depth);
    texture.format = THREE.RedFormat;
    texture.type = THREE.FloatType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
}
const sdfToJSON = (sdfSource) => {
    return `{
        "data": [${Array.from(sdfSource.data).map(x => x.toFixed(3).toString()).join(", ")}],
        "width": ${sdfSource.width},
        "height": ${sdfSource.height},
        "depth": ${sdfSource.depth}
    }`
}
async function main() {
    // Setup basic renderer, controls, and profiler
    const clientWidth = window.innerWidth * 0.99;
    const clientHeight = window.innerHeight * 0.98;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, clientWidth / clientHeight, 0.1, 1000);
    camera.position.set(50, 75, 50);
    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(clientWidth, clientHeight);
    document.body.appendChild(renderer.domElement);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 25, 0);
    const stats = new Stats();
    stats.showPanel(0);
    document.body.appendChild(stats.dom);
    // Setup scene
    // Skybox
    const environment = await new THREE.CubeTextureLoader().loadAsync([
        "skybox/Box_Right.bmp",
        "skybox/Box_Left.bmp",
        "skybox/Box_Top.bmp",
        "skybox/Box_Bottom.bmp",
        "skybox/Box_Front.bmp",
        "skybox/Box_Back.bmp"
    ]);
    environment.encoding = THREE.sRGBEncoding;
    scene.background = environment;
    // Lighting
    const ambientLight = new THREE.AmbientLight(new THREE.Color(1.0, 1.0, 1.0), 0.25);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.35);
    directionalLight.position.set(150, 200, 50);
    // Shadows
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.left = -75;
    directionalLight.shadow.camera.right = 75;
    directionalLight.shadow.camera.top = 75;
    directionalLight.shadow.camera.bottom = -75;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.bias = -0.001;
    directionalLight.shadow.blurSamples = 8;
    directionalLight.shadow.radius = 4;
    scene.add(directionalLight);
    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.15);
    directionalLight2.color.setRGB(1.0, 1.0, 1.0);
    directionalLight2.position.set(-50, 200, -150);
    //scene.add(directionalLight2);
    // Objects
    const ground = new THREE.Mesh(new THREE.BoxGeometry(100, 1.0, 100).applyMatrix4(new THREE.Matrix4().makeTranslation(0.0, -1.0 / 2.0, 0.0)), new THREE.MeshStandardMaterial({ color: new THREE.Color(0.8, 0.8, 0.8), side: THREE.DoubleSide }));
    ground.castShadow = true;
    ground.receiveShadow = true;
    //scene.add(ground);
    const box = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: new THREE.Color(1.0, 0.0, 0.0) }));
    box.castShadow = true;
    box.receiveShadow = true;
    box.position.y = 5.01;
    //scene.add(box);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(6.25, 32, 32), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, envMap: environment, metalness: 1.0, roughness: 0.25 }));
    sphere.position.y = 7.5;
    sphere.position.x = 25;
    sphere.position.z = 25;
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    //scene.add(sphere);
    const torusKnot = new THREE.Mesh(new THREE.TorusKnotGeometry(5, 1.5, 200, 32), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, envMap: environment, metalness: 0.5, roughness: 0.5, color: new THREE.Color(0.0, 1.0, 0.0) }));
    torusKnot.position.y = 10;
    torusKnot.position.x = -25;
    torusKnot.position.z = -25;
    torusKnot.castShadow = true;
    torusKnot.receiveShadow = true;
    //scene.add(torusKnot);
    const dragonGeo = (await AssetManager.loadGLTFAsync("dragon.glb")).scene.children[0].children[0].geometry;
    const bunnyGeo = (await AssetManager.loadGLTFAsync("bunny.glb")).scene.children[0].children[0].geometry;
    const dragon = new THREE.Mesh(dragonGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2)).applyMatrix4(new THREE.Matrix4().makeScale(3.0, 3.0, 3.0)), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, envMap: environment, metalness: 0.5, roughness: 0.2, color: new THREE.Color(0.0, 1.0, 0.0) }));
    dragon.geometry.boundsTree = new MeshBVHLib.MeshBVH(dragon.geometry);
    const bunny = new THREE.Mesh(bunnyGeo.applyMatrix4(new THREE.Matrix4().makeScale(0.075, 0.075, 0.075)).applyMatrix4(new THREE.Matrix4().makeTranslation(0, 18, 0)));
    bunny.geometry.boundsTree = new MeshBVHLib.MeshBVH(bunny.geometry);
    const teapot = new THREE.Mesh(new TeapotGeometry().applyMatrix4(new THREE.Matrix4().makeScale(0.25, 0.25, 0.25)).applyMatrix4(new THREE.Matrix4().makeTranslation(0, 10, 0)));
    teapot.geometry.boundsTree = new MeshBVHLib.MeshBVH(teapot.geometry);
    const boundingBox = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0, 20, 0), new THREE.Vector3(50, 40, 50));
    const boundingBoxHelper = new THREE.Box3Helper(boundingBox, 0xffff00);
    const sponza = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setDRACOLoader(new DRACOLoader().setDecoderPath("./")).loadAsync("LittlestTokyo.glb")).scene;
    sponza.scale.set(0.48, 0.48, 0.48);
    sponza.traverse(object => {
        if (object.isMesh && object.material) {
            if (object.material.color.r === 0.01361838816699617) {
                object.visible = false;
            }
            /*if (object.material.side === THREE.FrontSide) {
                object.material.side = THREE.DoubleSide;
            } else if (object.material.side === THREE.BackSide) {
                console.log("Ye")
                object.visible = false;
            }*/
        }
    })
    sponza.traverse(o => {
        if (o.material instanceof THREE.MeshPhysicalMaterial) {
            const oldMat = o.material;
            o.material = new THREE.MeshStandardMaterial({});
            if (oldMat.color) {
                o.material.color = oldMat.color;
            }
            if (oldMat.metalness) {
                o.material.metalness = oldMat.metalness;
            }
            if (oldMat.roughness) {
                o.material.roughness = oldMat.roughness;
            }
            if (oldMat.map) {
                o.material.map = oldMat.map;
            }
            if (oldMat.envMap) {
                o.material.map = oldMat.envMap;
            }
            if (oldMat.normalMap) {
                o.material.normalMap = oldMat.normalMap;
            }
            if (oldMat.roughnessMap) {
                o.material.roughnessMap = oldMat.roughnessMap;
            }
            if (oldMat.metalnessMap) {
                o.material.metalnessMap = oldMat.metalnessMap;
            }
        }
    });
    sponza.traverse(object => {
        if (object.material) {
            object.material.envMap = environment;
            object.material.envMapIntensity = 1.0;
        }
    });
    scene.add(sponza);
    sponza.visible = false;
    let geometries = [];
    sponza.traverse(object => {
        const cloned = new THREE.Mesh(object.geometry, object.material);
        object.getWorldPosition(cloned.position);
        if (object.geometry && object.visible) {
            const cloned = object.geometry.clone();
            cloned.applyMatrix4(object.matrixWorld);
            for (const key in cloned.attributes) {
                if (key !== 'position') { cloned.deleteAttribute(key); }
            }
            geometries.push(cloned);
        }
    });
    const mergedGeometry = BufferGeometryUtils.mergeBufferGeometries(geometries, false);
    mergedGeometry.boundsTree = new MeshBVH(mergedGeometry, { lazyGeneration: false, strategy: SAH });
    const collider = new THREE.Mesh(mergedGeometry);
    collider.material.wireframe = true;
    collider.material.opacity = 0.5;
    collider.material.transparent = true;
    collider.visible = false;
    collider.boundsTree = mergedGeometry.boundsTree;
    //scene.add(collider);

    const visualizer = new MeshBVHVisualizer(collider, 20);
    visualizer.visible = false;
    visualizer.update();
    //scene.add(visualizer);
    const boundingBoxSponza = new THREE.Box3().setFromObject(new THREE.Mesh(mergedGeometry), true);
    boundingBoxSponza.min.x = Math.floor(boundingBoxSponza.min.x) - 1;
    boundingBoxSponza.min.y = Math.floor(boundingBoxSponza.min.y) - 1;
    boundingBoxSponza.min.z = Math.floor(boundingBoxSponza.min.z) - 1;
    boundingBoxSponza.max.x = Math.ceil(boundingBoxSponza.max.x) + 1;
    boundingBoxSponza.max.y = Math.ceil(boundingBoxSponza.max.y) + 1;
    boundingBoxSponza.max.z = Math.ceil(boundingBoxSponza.max.z) + 1;
    //scene.add(new THREE.Box3Helper(boundingBoxSponza, 0xffff00))
    console.time();
    let [sponzaTexture, sponzaColor] = makeSDFTextureGPU(mergedGeometry.boundsTree, boundingBoxSponza, 1.0, renderer, sponza);
    console.timeEnd();
    /*console.time();
    let bunnyTexture = makeSDFTextureGPU(bunny.geometry.boundsTree, boundingBox, 4.0, renderer);
    console.timeEnd();
    console.time();
    let dragonTexture = makeSDFTextureGPU(dragon.geometry.boundsTree, boundingBox, 4.0, renderer); //    makeSDFFromSource(await (await fetch("./dragonsdf.json")).json());
    console.timeEnd();*/
    const effectController = {
        normalStep: 1,
        lightFocus: 32.0
    };
    const gui = new GUI();
    gui.add(effectController, "normalStep", 0.1, 2, 0.001).name("Normal Steps");
    gui.add(effectController, "lightFocus", 1.0, 128.0, 0.001).name("Light Focus");
    const defaultTexture = new THREE.WebGLRenderTarget(clientWidth, clientHeight, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.NearestFilter,
        type: THREE.FloatType
    });
    defaultTexture.depthTexture = new THREE.DepthTexture(clientWidth, clientHeight, THREE.FloatType);
    // Post Effects
    const composer = new EffectComposer(renderer);
    const smaaPass = new SMAAPass(clientWidth, clientHeight);
    const effectPass = new ShaderPass(EffectShader);
    composer.addPass(effectPass);
    composer.addPass(new ShaderPass(GammaCorrectionShader));
    composer.addPass(smaaPass);
    const sdfTransform = new THREE.Object3D();
    const normalTexture = new THREE.WebGLRenderTarget(clientWidth, clientWidth, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.NearestFilter,
        type: THREE.FloatType
    });
    normalTexture.depthTexture = new THREE.DepthTexture(clientWidth, clientWidth, THREE.FloatType);
    const normalMat = new THREE.MeshNormalMaterial();
    const noiseTex = await new THREE.TextureLoader().loadAsync("bluenoise.png");
    noiseTex.wrapS = THREE.RepeatWrapping;
    noiseTex.wrapT = THREE.RepeatWrapping;
    noiseTex.magFilter = THREE.NearestFilter;
    noiseTex.minFilter = THREE.NearestFilter;
    let lastTime = performance.now();

    function animate() {
        const delta = (performance.now() - lastTime) / 16.666;
        lastTime = performance.now();
        renderer.setRenderTarget(defaultTexture);
        renderer.clear();
        renderer.render(scene, camera);
        scene.overrideMaterial = normalMat;
        renderer.setRenderTarget(normalTexture);
        renderer.clear();
        renderer.render(scene, camera);
        scene.overrideMaterial = null;
        // sdfTransform.rotation.y += 0.01 * delta;
        //sdfTransform.position.y = 0;
        //sdfTransform.position.y = 0.0 + Math.sin(performance.now() / 5000);
        sdfTransform.updateMatrix();
        effectPass.uniforms["sceneDiffuse"].value = defaultTexture.texture;
        effectPass.uniforms["sceneDepth"].value = defaultTexture.depthTexture;
        effectPass.uniforms["sdfTexture1"].value = sponzaTexture;
        effectPass.uniforms["sdfTexture2"].value = sponzaColor;
        effectPass.uniforms["sdfTexture3"].value = sponzaTexture;
        effectPass.uniforms["boxCenter"].value = boundingBoxSponza.clone().getCenter(new THREE.Vector3());
        effectPass.uniforms["boxSize"].value = boundingBoxSponza.clone().getSize(new THREE.Vector3());
        effectPass.uniforms["projectionMatrixInv"].value = camera.projectionMatrixInverse;
        effectPass.uniforms["viewMatrixInv"].value = camera.matrixWorld;
        effectPass.uniforms["cameraPos"].value = camera.position;
        effectPass.uniforms["normalStep"].value = effectController.normalStep;
        effectPass.uniforms["time"].value = performance.now() / 1000;
        effectPass.uniforms["sdfMat"].value = sdfTransform.matrix;
        effectPass.uniforms["sdfMatInv"].value = sdfTransform.matrix.clone().invert();
        effectPass.uniforms["resolution"].value = new THREE.Vector2(clientWidth, clientHeight);
        effectPass.uniforms["normalTexture"].value = normalTexture.texture;
        effectPass.uniforms["lightFocus"].value = effectController.lightFocus;
        //effectPass.uniforms["blueNoise"].value = noiseTex;
        composer.render();
        controls.update();
        stats.update();
        requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
}
main();