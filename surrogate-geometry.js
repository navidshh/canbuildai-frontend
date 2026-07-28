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

    // ------------------------------------------------------------------
    // OSM-based geometry (real DOE prototype models)
    // ------------------------------------------------------------------
    // The wizard ships pre-parsed JSON files under /geometry/<Archetype>.json,
    // built by frontend/parse_osm.py from the ASHRAE 90.1 / DOE reference OSMs.
    // The viewer loads them lazily and falls back to the parametric "boxes"
    // renderer below if a fetch fails.
    const OSM_GEOMETRY_URL = 'geometry/';   // relative to page URL
    const _osmCache = Object.create(null);  // archetype -> Promise<data|null>

    function loadOsmGeometry(archetype) {
        if (_osmCache[archetype]) return _osmCache[archetype];
        const url = `${OSM_GEOMETRY_URL}${archetype}.json`;
        _osmCache[archetype] = fetch(url, { credentials: 'omit' })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
        return _osmCache[archetype];
    }

    // Surface-type palette (colour by OS:Surface.Type). Matches typical
    // OpenStudio visualisation conventions.
    const SURFACE_TYPE_COLORS = {
        Wall:         0xd0d5db,  // light grey (opaque walls)
        RoofCeiling:  0xf7c26a,  // warm amber (roof/ceiling)
        Floor:        0x7a6d5c,  // brown (floor slabs)
        // SubSurface types
        FixedWindow:  0x66b7ff,  // sky blue
        OperableWindow: 0x4aa1ea,
        Door:         0x8b5a3c,  // brown door
        GlassDoor:    0x9ad0ff,
        Skylight:     0xa9dfff,
        OverheadDoor: 0x7c5636
    };

    // Palette used to colour ThermalZones (cycles through this list).
    const THERMAL_ZONE_PALETTE = [
        0x4f86c6, 0xe2553a, 0xf2c14e, 0x4caf66, 0x9c6ade,
        0xef7fbf, 0x5ac8fa, 0xff9800, 0x8bc34a, 0x795548,
        0x00acc1, 0xd81b60, 0x7cb342, 0xff5722, 0x3949ab,
        0x00897b, 0xe53935, 0xc0ca33, 0x1e88e5, 0xffb300
    ];

    function colorForZone(zoneName, zoneList) {
        // Try exact index from the JSON's zone list.
        if (zoneList) {
            for (let i = 0; i < zoneList.length; i++) {
                if (zoneList[i].name === zoneName) {
                    return THERMAL_ZONE_PALETTE[i % THERMAL_ZONE_PALETTE.length];
                }
            }
        }
        // Fallback: hash the name to pick a stable colour.
        let h = 0;
        for (let i = 0; i < (zoneName || '').length; i++) {
            h = (h * 31 + zoneName.charCodeAt(i)) >>> 0;
        }
        return THERMAL_ZONE_PALETTE[h % THERMAL_ZONE_PALETTE.length];
    }

    // --- Canonical NECB / DOE-prototype building dimensions ------------------
    // Source: ASHRAE 90.1 Prototype Building Models / U.S. DOE Commercial
    // Reference Buildings — these are the official prototypes the NECB
    // archetypes are derived from.  Values rounded to 2 decimals.
    // LowriseApartment is NECB-specific (no DOE/90.1 prototype); footprint is
    // a typical Canadian 3-storey walk-up approximation.
    //
    // Floor count is intentionally also tracked in app.js
    // (ARCHETYPE_GEOMETRY.*.bldg_standards_number_of_above_ground_stories) so
    // the same number is sent to the backend. createBuildingViewer() prefers
    // window.ARCHETYPE_GEOMETRY at runtime so the viewer never disagrees with
    // what the model is actually being fed.
    const ARCHETYPE_DIMENSIONS = {
        HighRise: {
            label: 'High Rise Apartment',
            stories: 10,
            width: 47.24,    // ASHRAE 90.1 HighRiseApartment
            depth: 14.94,
            floorHeight: 3.05,
            perimeterDepth: 4.57,
            source: 'ASHRAE 90.1 HighRiseApartment prototype'
        },
        MidRise: {
            label: 'Mid Rise Apartment',
            stories: 4,
            width: 46.32,    // ASHRAE 90.1 / DOE MidriseApartment
            depth: 16.46,
            floorHeight: 3.05,
            perimeterDepth: 4.57,
            source: 'ASHRAE 90.1 / DOE MidriseApartment prototype'
        },
        LowRise: {
            label: 'Low Rise Apartment',
            stories: 3,
            width: 32.0,
            depth: 13.0,
            floorHeight: 3.05,
            perimeterDepth: 3.5,
            source: 'NECB LowriseApartment (approx. Canadian 3-storey walk-up)'
        },
        LargeOffice: {
            label: 'Large Office',
            stories: 12,
            width: 73.13,    // DOE LargeOffice (excludes basement)
            depth: 48.77,
            floorHeight: 3.96,
            perimeterDepth: 4.57,
            source: 'ASHRAE 90.1 / DOE LargeOffice prototype (above grade)'
        },
        MediumOffice: {
            label: 'Medium Office',
            stories: 3,
            width: 49.91,    // DOE MediumOffice
            depth: 33.27,
            floorHeight: 3.96,
            perimeterDepth: 4.57,
            source: 'ASHRAE 90.1 / DOE MediumOffice prototype'
        },
        SmallOffice: {
            label: 'Small Office',
            stories: 1,
            width: 27.69,    // DOE SmallOffice
            depth: 18.46,
            floorHeight: 3.05,
            perimeterDepth: 4.57,
            source: 'ASHRAE 90.1 / DOE SmallOffice prototype'
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
        const base =
            ARCHETYPE_DIMENSIONS[archetype] || ARCHETYPE_DIMENSIONS.MidRise;
        // Prefer the stories count from app.js's ARCHETYPE_GEOMETRY (the same
        // value the backend gets), so the viewer can never disagree with the
        // model. Falls back to the canonical table above.
        const backend =
            (global.ARCHETYPE_GEOMETRY && global.ARCHETYPE_GEOMETRY[archetype]) ||
            null;
        const stories =
            (backend && backend.bldg_standards_number_of_above_ground_stories) ||
            base.stories;
        return Object.assign({}, base, { stories });
    }

    /**
     * Make a small text "sticker" sprite (e.g. "F3") that always faces the
     * camera.  Returns a THREE.Sprite ready to position.
     */
    function makeFloorLabel(text, THREE) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        // Pill background
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        const r = 18;
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(canvas.width - r, 0);
        ctx.quadraticCurveTo(canvas.width, 0, canvas.width, r);
        ctx.lineTo(canvas.width, canvas.height - r);
        ctx.quadraticCurveTo(canvas.width, canvas.height, canvas.width - r, canvas.height);
        ctx.lineTo(r, canvas.height);
        ctx.quadraticCurveTo(0, canvas.height, 0, canvas.height - r);
        ctx.lineTo(0, r);
        ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.closePath();
        ctx.fill();
        // Label text
        ctx.fillStyle = '#fafafa';
        ctx.font = 'bold 40px system-ui, -apple-system, Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        const mat = new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            depthTest: false,  // always render in front so labels stay readable
            depthWrite: false
        });
        const sprite = new THREE.Sprite(mat);
        // World-space size: ~3m wide × 1.5m tall (readable but unobtrusive)
        sprite.scale.set(3.2, 1.6, 1);
        sprite.renderOrder = 999;
        return sprite;
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
        // Reserve room at the bottom of each floor for a visible slab/band.
        const slabHeight = 0.22;
        const h = floorHeight - slabHeight - 0.05;
        const yMid = yBase + slabHeight + h / 2;

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

        // Inter-floor band: thicker than before and overhanging the wall on
        // every side so each floor reads as a distinct stack rather than a
        // continuous column.
        const overhang = 0.5;
        const slab = new THREE.Mesh(
            new THREE.BoxGeometry(width + overhang, slabHeight, depth + overhang),
            new THREE.MeshStandardMaterial({
                color: 0x1f2937,
                roughness: 0.95,
                metalness: 0.0
            })
        );
        slab.position.set(0, yBase + slabHeight / 2, 0);
        group.add(slab);

        // Floor-number label at the SW corner just above the slab.
        const label = makeFloorLabel(`F${floorIndex + 1}`, THREE);
        label.position.set(
            -(width / 2) - 2.0,
            yBase + slabHeight + 0.9,
            (depth / 2) + 2.0
        );
        group.add(label);

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

    // ------------------------------------------------------------------
    // OSM builder: real geometry from ASHRAE/DOE prototype .osm files.
    // ------------------------------------------------------------------

    /**
     * Fan-triangulate a planar polygon (vertices are [x,y,z]).
     * Assumes the polygon is convex (walls, floors, roofs in DOE prototypes
     * are all convex rectangles). Returns a THREE.BufferGeometry.
     */
    function polygonToGeometry(vertices, THREE) {
        const n = vertices.length;
        if (n < 3) return null;
        // Positions for a triangle fan v0-vi-vi+1 for i in [1..n-2]
        const triCount = n - 2;
        const positions = new Float32Array(triCount * 3 * 3);
        let o = 0;
        const v0 = vertices[0];
        for (let i = 1; i < n - 1; i++) {
            const va = vertices[i];
            const vb = vertices[i + 1];
            positions[o++] = v0[0]; positions[o++] = v0[1]; positions[o++] = v0[2];
            positions[o++] = va[0]; positions[o++] = va[1]; positions[o++] = va[2];
            positions[o++] = vb[0]; positions[o++] = vb[1]; positions[o++] = vb[2];
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.computeVertexNormals();
        return geom;
    }

    /**
     * Build a Three.js Group from an OSM-derived geometry JSON. Each surface
     * becomes one mesh with its colour driven by `colorMode`.
     *
     * OSM stores Z as vertical. Three.js uses Y as vertical. We remap
     * (X, Y, Z) -> (X, Z, -Y) so the north-facing +Z axis (compass) matches
     * the parametric renderer's convention (-Z = North).
     */
    function buildFromOsm(data, opts, THREE) {
        const colorMode = opts.colorMode || 'thermal_zone';
        const group = new THREE.Group();
        group.name = `osm_${data.archetype}`;

        // Centre in X/Y (world XZ) so the building sits above the ground plane
        // at origin regardless of the OSM's absolute coordinates.
        const bb = data.bbox;
        const cx = bb ? (bb.min[0] + bb.max[0]) / 2 : 0;
        const cy = bb ? (bb.min[1] + bb.max[1]) / 2 : 0;
        const minZ = bb ? bb.min[2] : 0;

        // Colour cache so opaque walls in the same zone share a material.
        const matCache = new Map();
        function getMat(hex, opacity) {
            const key = `${hex}_${opacity}`;
            let m = matCache.get(key);
            if (!m) {
                m = new THREE.MeshStandardMaterial({
                    color: hex,
                    roughness: 0.7,
                    metalness: 0.05,
                    transparent: opacity < 1,
                    opacity: opacity,
                    side: THREE.DoubleSide,
                    flatShading: false
                });
                matCache.set(key, m);
            }
            return m;
        }

        function pickColorAndOpacity(surface) {
            if (colorMode === 'surface_type') {
                const c = SURFACE_TYPE_COLORS[surface.type] || 0xcccccc;
                // Walls slightly translucent so zones inside are hinted at.
                const op = surface.type === 'Wall' ? 0.75 : 1.0;
                return [c, op];
            }
            // thermal_zone (uses friendly display name derived at parse time)
            const zn = surface.zone_display || surface.zone;
            const c = colorForZone(zn, data.zones);
            return [c, 0.9];
        }

        function remap(v) {
            // OSM (X east, Y north, Z up) -> Three.js (X east, Y up, Z south)
            return [v[0] - cx, v[2] - minZ, -(v[1] - cy)];
        }

        for (const s of data.surfaces) {
            if (!s.vertices || s.vertices.length < 3) continue;
            const verts = s.vertices.map(remap);
            const geom = polygonToGeometry(verts, THREE);
            if (!geom) continue;
            const [c, op] = pickColorAndOpacity(s);
            const mat = getMat(c, op);
            const mesh = new THREE.Mesh(geom, mat);
            mesh.name = s.name;
            mesh.userData = {
                surfaceType: s.type,
                zone: s.zone,
                story: s.story,
                boundary: s.boundary
            };
            group.add(mesh);
        }

        // Subsurfaces (windows, doors, skylights) — always coloured by type
        // and offset outward slightly to avoid z-fighting with the parent wall.
        for (const ss of data.subsurfaces) {
            if (!ss.vertices || ss.vertices.length < 3) continue;
            const verts = ss.vertices.map(remap);
            const geom = polygonToGeometry(verts, THREE);
            if (!geom) continue;
            const c = SURFACE_TYPE_COLORS[ss.type] || 0x66b7ff;
            const mat = getMat(c, 0.85);
            const mesh = new THREE.Mesh(geom, mat);
            mesh.name = ss.name;
            mesh.userData = { subSurfaceType: ss.type, parent: ss.parent };
            // Nudge the mesh very slightly along its face normal so it sits
            // in front of the parent surface (prevents z-fighting).
            geom.computeVertexNormals();
            const n = geom.attributes.normal;
            if (n && n.count > 0) {
                const nx = n.getX(0), ny = n.getY(0), nz = n.getZ(0);
                mesh.position.set(nx * 0.02, ny * 0.02, nz * 0.02);
            }
            group.add(mesh);
        }

        // Derive dims from bbox so camera framing works the same as the
        // parametric path.
        const dims = bb ? {
            width: bb.size[0],
            depth: bb.size[1],
            floorHeight: bb.size[2] / Math.max(data.stories.length, 1),
            stories: data.stories.length || 1
        } : { width: 40, depth: 20, floorHeight: 3, stories: 1 };

        return { group, dims };
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
        let colorMode = options.colorMode || 'thermal_zone';   // or 'surface_type'
        let currentIsOsm = false;    // whether the current mesh came from OSM JSON

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

        // Try to swap in the higher-fidelity OSM geometry as soon as it loads.
        // Runs on every archetype change too (see setArchetype).
        function tryLoadOsm(archetype) {
            loadOsmGeometry(archetype).then((data) => {
                if (!data || currentArchetype !== archetype) return;
                disposeBuildingGroup();
                const built = buildFromOsm(data, { colorMode }, THREE);
                buildingGroup = built.group;
                dims = built.dims;
                currentIsOsm = true;
                buildingGroup.rotation.y = THREE.MathUtils.degToRad(yawDeg);
                scene.add(buildingGroup);
                frameBuilding(camera, controls, dims);
            });
        }

        function disposeBuildingGroup() {
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
        }

        tryLoadOsm(currentArchetype);

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
            disposeBuildingGroup();

            // Show parametric placeholder while we fetch OSM JSON.
            const rebuilt = buildBuilding(currentArchetype, THREE);
            buildingGroup = rebuilt.group;
            dims = rebuilt.dims;
            currentIsOsm = false;
            buildingGroup.rotation.y = THREE.MathUtils.degToRad(yawDeg);
            scene.add(buildingGroup);
            frameBuilding(camera, controls, dims);

            // Swap in the OSM version once it's fetched (or use cached).
            tryLoadOsm(currentArchetype);
        }

        function setColorMode(mode) {
            if (mode !== 'surface_type' && mode !== 'thermal_zone') return;
            if (mode === colorMode) return;
            colorMode = mode;
            // Only meaningful for the OSM path; parametric renderer already
            // uses fixed perimeter-direction colours.
            if (!currentIsOsm) return;
            loadOsmGeometry(currentArchetype).then((data) => {
                if (!data || !currentIsOsm) return;
                disposeBuildingGroup();
                const built = buildFromOsm(data, { colorMode }, THREE);
                buildingGroup = built.group;
                dims = built.dims;
                buildingGroup.rotation.y = THREE.MathUtils.degToRad(yawDeg);
                scene.add(buildingGroup);
                frameBuilding(camera, controls, dims);
            });
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
            setColorMode,
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
        SURFACE_TYPE_COLORS,
        THERMAL_ZONE_PALETTE,
        getArchetypeDimensions,
        loadOsmGeometry
    };
})(window);
