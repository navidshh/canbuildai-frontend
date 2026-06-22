/**
 * surrogate-geometry.js
 *
 * Parametric 3D building viewer for the Early Building Design Advisor wizard.
 *
 * Renders a Three.js scene of the selected NECB-style archetype with
 * color-coded thermal zones (1 core + 4 perimeter zones per floor).
 * The user can mouse-rotate the scene; an optional rotation slider drives
 * the building yaw to mirror the :rotation_degrees input.
 *
 * Public API:
 *   const viewer = createBuildingViewer({ container, archetype, rotationDeg });
 *   viewer.setArchetype('HighRise');
 *   viewer.setRotation(45);            // degrees
 *   viewer.dispose();                  // free GPU resources
 *
 * Requires three.js + OrbitControls loaded globally (see surrogate-model.html).
 */

(function (global) {
    'use strict';

    // --- Canonical NECB / DOE-prototype building dimensions ------------------
    // (Approximate; tuned for visualisation, not for thermal calcs.)
    // width / depth in metres, floorHeight in metres.
    const ARCHETYPE_DIMENSIONS = {
        HighRise: {
            label: 'High Rise Apartment',
            stories: 10,
            width: 28.0,
            depth: 28.0,
            floorHeight: 3.0,
            perimeterDepth: 4.5
        },
        MidRise: {
            label: 'Mid Rise Apartment',
            stories: 4,
            width: 46.0,
            depth: 17.0,
            floorHeight: 3.0,
            perimeterDepth: 4.5
        },
        LowRise: {
            label: 'Low Rise Apartment',
            stories: 3,
            width: 30.0,
            depth: 12.0,
            floorHeight: 3.0,
            perimeterDepth: 3.5
        },
        LargeOffice: {
            label: 'Large Office',
            stories: 12,
            width: 73.1,
            depth: 48.8,
            floorHeight: 3.6,
            perimeterDepth: 4.57
        },
        MediumOffice: {
            label: 'Medium Office',
            stories: 3,
            width: 49.9,
            depth: 33.3,
            floorHeight: 3.6,
            perimeterDepth: 4.57
        },
        SmallOffice: {
            label: 'Small Office',
            stories: 1,
            width: 27.7,
            depth: 18.5,
            floorHeight: 3.0,
            perimeterDepth: 4.57
        }
    };

    // Zone colours (perimeter by cardinal direction + interior core).
    const ZONE_COLORS = {
        core:  0x9aa7b4, // cool grey
        north: 0x4f86c6, // blue
        south: 0xe2553a, // warm red/orange
        east:  0xf2c14e, // amber/yellow
        west:  0x4caf66  // green
    };

    function getArchetypeDimensions(archetype) {
        return ARCHETYPE_DIMENSIONS[archetype] || ARCHETYPE_DIMENSIONS.MidRise;
    }

    /**
     * Build a single floor's worth of zone meshes (5 boxes) and return them
     * as a Three.js Group positioned at y = floorIndex * floorHeight.
     */
    function buildFloor(dims, floorIndex, THREE) {
        const { width, depth, floorHeight, perimeterDepth } = dims;
        const pd = Math.min(perimeterDepth, Math.min(width, depth) * 0.4);
        const coreW = Math.max(width - 2 * pd, 0.1);
        const coreD = Math.max(depth - 2 * pd, 0.1);

        const yBase = floorIndex * floorHeight;
        const group = new THREE.Group();
        group.name = `floor_${floorIndex}`;

        // Slightly inset edges so neighbouring boxes don't z-fight on shared faces.
        const e = 0.02;
        const h = floorHeight - 0.05;
        const yMid = yBase + h / 2;

        const mat = (color) =>
            new THREE.MeshStandardMaterial({
                color,
                roughness: 0.55,
                metalness: 0.05,
                flatShading: false
            });

        // North perimeter zone (+Z half by convention here we use -Z = north for screen up)
        const north = new THREE.Mesh(
            new THREE.BoxGeometry(width - e, h, pd - e),
            mat(ZONE_COLORS.north)
        );
        north.position.set(0, yMid, -(depth / 2 - pd / 2));
        group.add(north);

        // South perimeter zone
        const south = new THREE.Mesh(
            new THREE.BoxGeometry(width - e, h, pd - e),
            mat(ZONE_COLORS.south)
        );
        south.position.set(0, yMid, depth / 2 - pd / 2);
        group.add(south);

        // East perimeter zone (along +X)
        const east = new THREE.Mesh(
            new THREE.BoxGeometry(pd - e, h, coreD - e),
            mat(ZONE_COLORS.east)
        );
        east.position.set(width / 2 - pd / 2, yMid, 0);
        group.add(east);

        // West perimeter zone (along -X)
        const west = new THREE.Mesh(
            new THREE.BoxGeometry(pd - e, h, coreD - e),
            mat(ZONE_COLORS.west)
        );
        west.position.set(-(width / 2 - pd / 2), yMid, 0);
        group.add(west);

        // Core zone (interior)
        if (coreW > 0.1 && coreD > 0.1) {
            const core = new THREE.Mesh(
                new THREE.BoxGeometry(coreW - e, h, coreD - e),
                mat(ZONE_COLORS.core)
            );
            core.position.set(0, yMid, 0);
            group.add(core);
        }

        // Thin floor-slab line as an edge highlight for readability.
        const slabHeight = 0.04;
        const slab = new THREE.Mesh(
            new THREE.BoxGeometry(width + 0.01, slabHeight, depth + 0.01),
            new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 1.0 })
        );
        slab.position.set(0, yBase + slabHeight / 2, 0);
        group.add(slab);

        return group;
    }

    /**
     * Build the full building (all floors) as a Group, centred at origin in
     * x/z with the ground floor on y=0.
     */
    function buildBuilding(archetype, THREE) {
        const dims = getArchetypeDimensions(archetype);
        const building = new THREE.Group();
        building.name = `building_${archetype}`;

        for (let i = 0; i < dims.stories; i++) {
            building.add(buildFloor(dims, i, THREE));
        }

        return { group: building, dims };
    }

    /**
     * Configure camera + controls to nicely frame a building of the given
     * dimensions. Keeps the user's current orbit angle if controls exist.
     */
    function frameBuilding(camera, controls, dims) {
        const totalHeight = dims.stories * dims.floorHeight;
        const longestSide = Math.max(dims.width, dims.depth);
        // Distance picked to give a comfortable 3/4 view of the tallest building.
        const dist = Math.max(longestSide * 1.6, totalHeight * 1.4, 40);
        camera.position.set(dist * 0.75, totalHeight * 0.9 + 10, dist);
        camera.near = 0.5;
        camera.far = dist * 8;
        camera.updateProjectionMatrix();

        if (controls) {
            controls.target.set(0, totalHeight / 2, 0);
            controls.update();
        }
    }

    function createGroundPlane(THREE) {
        const geom = new THREE.PlaneGeometry(800, 800);
        const mat = new THREE.MeshStandardMaterial({
            color: 0xf3f4f6,
            roughness: 1.0,
            metalness: 0.0
        });
        const plane = new THREE.Mesh(geom, mat);
        plane.rotation.x = -Math.PI / 2;
        plane.position.y = -0.01;
        plane.receiveShadow = true;
        return plane;
    }

    function createCompassRose(THREE) {
        const group = new THREE.Group();
        group.name = 'compass';

        // Simple cross of two thin boxes
        const armMat = new THREE.MeshBasicMaterial({ color: 0x4b5563 });
        const armLen = 6;
        const armWide = 0.12;

        const ns = new THREE.Mesh(
            new THREE.BoxGeometry(armWide, 0.05, armLen),
            armMat
        );
        const ew = new THREE.Mesh(
            new THREE.BoxGeometry(armLen, 0.05, armWide),
            armMat
        );
        group.add(ns);
        group.add(ew);

        // North arrowhead (red triangle)
        const northTip = new THREE.Mesh(
            new THREE.ConeGeometry(0.6, 1.4, 4),
            new THREE.MeshBasicMaterial({ color: 0xdc2626 })
        );
        northTip.position.set(0, 0.05, -armLen / 2 - 0.7);
        northTip.rotation.x = -Math.PI / 2;
        group.add(northTip);

        return group;
    }

    // ---- Public factory -----------------------------------------------------
    function createBuildingViewer(options) {
        const { container } = options;
        if (!container) {
            throw new Error('createBuildingViewer: `container` element is required');
        }
        const THREE = global.THREE;
        if (!THREE) {
            throw new Error(
                'createBuildingViewer: window.THREE is not loaded. ' +
                'Include three.min.js before this script.'
            );
        }
        const OrbitControlsCtor =
            (THREE.OrbitControls) ||
            (global.OrbitControls);
        if (!OrbitControlsCtor) {
            console.warn(
                'createBuildingViewer: OrbitControls not found. ' +
                'The building will still render but the user cannot rotate it.'
            );
        }

        let currentArchetype = options.archetype || 'MidRise';
        let yawDeg = Number.isFinite(options.rotationDeg) ? options.rotationDeg : 0;

        // --- Scene setup ----------------------------------------------------
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xeef2f7);

        // Lights
        const ambient = new THREE.AmbientLight(0xffffff, 0.55);
        scene.add(ambient);
        const sun = new THREE.DirectionalLight(0xffffff, 0.95);
        sun.position.set(80, 140, 60);
        scene.add(sun);
        const fill = new THREE.DirectionalLight(0xffffff, 0.25);
        fill.position.set(-80, 60, -40);
        scene.add(fill);

        // Ground + compass
        const ground = createGroundPlane(THREE);
        scene.add(ground);
        scene.add(createCompassRose(THREE));

        // Camera
        const rect0 = container.getBoundingClientRect();
        const aspect = (rect0.width || 600) / (rect0.height || 400);
        const camera = new THREE.PerspectiveCamera(45, aspect, 0.5, 4000);

        // Renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(global.devicePixelRatio || 1);
        renderer.setSize(rect0.width || 600, rect0.height || 400);
        container.appendChild(renderer.domElement);
        renderer.domElement.style.display = 'block';
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';

        // Controls
        let controls = null;
        if (OrbitControlsCtor) {
            controls = new OrbitControlsCtor(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.08;
            controls.minDistance = 10;
            controls.maxDistance = 800;
            controls.maxPolarAngle = Math.PI * 0.49; // don't go below the ground plane
        }

        // Building
        let { group: buildingGroup, dims } = buildBuilding(currentArchetype, THREE);
        buildingGroup.rotation.y = THREE.MathUtils.degToRad(yawDeg);
        scene.add(buildingGroup);
        frameBuilding(camera, controls, dims);

        // --- Animation loop -------------------------------------------------
        let running = true;
        function animate() {
            if (!running) return;
            global.requestAnimationFrame(animate);
            if (controls) controls.update();
            renderer.render(scene, camera);
        }
        animate();

        // --- Resize handling ------------------------------------------------
        function handleResize() {
            const rect = container.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            camera.aspect = rect.width / rect.height;
            camera.updateProjectionMatrix();
            renderer.setSize(rect.width, rect.height, false);
        }
        const ro =
            typeof global.ResizeObserver === 'function'
                ? new global.ResizeObserver(handleResize)
                : null;
        if (ro) ro.observe(container);
        global.addEventListener('resize', handleResize);

        // --- Public methods -------------------------------------------------
        function setArchetype(archetype) {
            if (archetype === currentArchetype) return;
            currentArchetype = archetype;

            // Tear down old meshes to free GPU memory.
            scene.remove(buildingGroup);
            buildingGroup.traverse((obj) => {
                if (obj.isMesh) {
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) {
                        if (Array.isArray(obj.material)) {
                            obj.material.forEach((m) => m.dispose());
                        } else {
                            obj.material.dispose();
                        }
                    }
                }
            });

            const rebuilt = buildBuilding(currentArchetype, THREE);
            buildingGroup = rebuilt.group;
            dims = rebuilt.dims;
            buildingGroup.rotation.y = THREE.MathUtils.degToRad(yawDeg);
            scene.add(buildingGroup);
            frameBuilding(camera, controls, dims);
        }

        function setRotation(degrees) {
            if (!Number.isFinite(degrees)) return;
            yawDeg = degrees;
            if (buildingGroup) {
                buildingGroup.rotation.y = THREE.MathUtils.degToRad(yawDeg);
            }
        }

        function getDimensions() {
            return Object.assign({}, dims, { archetype: currentArchetype });
        }

        function dispose() {
            running = false;
            if (ro) ro.disconnect();
            global.removeEventListener('resize', handleResize);
            scene.traverse((obj) => {
                if (obj.isMesh) {
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) {
                        if (Array.isArray(obj.material)) {
                            obj.material.forEach((m) => m.dispose());
                        } else {
                            obj.material.dispose();
                        }
                    }
                }
            });
            renderer.dispose();
            if (renderer.domElement.parentNode) {
                renderer.domElement.parentNode.removeChild(renderer.domElement);
            }
        }

        return {
            setArchetype,
            setRotation,
            getDimensions,
            dispose
        };
    }

    // Expose API + constants on window so other scripts and the wizard can
    // share archetype geometry data (e.g. floor area for backend payload).
    global.SurrogateGeometry = {
        createBuildingViewer,
        ARCHETYPE_DIMENSIONS,
        ZONE_COLORS,
        getArchetypeDimensions
    };
})(window);
