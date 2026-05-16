import UploadPanel from './UploadPanel';

export default function MainApp({ user, onLogout }: { user: any; onLogout: () => void }) {
  const openFull3D = () => {
    const win = window.open('', '_blank', 'width=1600,height=1000');
    if (!win) return alert("Popup blocked. Allow popups for this site.");

    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>ConstructVision 3D Viewer</title>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js"></script>
        <style>
          body { margin:0; overflow:hidden; background:#03050f; }
          canvas { display:block; }
        </style>
      </head>
      <body>
        <script>
          const scene = new THREE.Scene();
          const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 1000);
          const renderer = new THREE.WebGLRenderer({ antialias: true });
          renderer.setSize(window.innerWidth, window.innerHeight);
          document.body.appendChild(renderer.domElement);

          // Lights
          scene.add(new THREE.AmbientLight(0xaaaaaa, 0.8));
          const light = new THREE.DirectionalLight(0xffffff, 1.5);
          light.position.set(100, 150, 100);
          scene.add(light);

          // Ground
          const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(400, 400),
            new THREE.MeshStandardMaterial({ color: 0x0d1a0d, roughness: 1 })
          );
          ground.rotation.x = -Math.PI / 2;
          ground.position.y = -6;
          scene.add(ground);

          // Building
          const building = new THREE.Mesh(
            new THREE.BoxGeometry(70, 22, 100),
            new THREE.MeshStandardMaterial({ color: 0xa8b8c8, metalness: 0.4, roughness: 0.6 })
          );
          building.position.y = 11;
          scene.add(building);

          camera.position.set(150, 110, 160);
          camera.lookAt(0, 20, 0);

          function animate() {
            requestAnimationFrame(animate);
            renderer.render(scene, camera);
          }
          animate();

          window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
          });
        </script>
      </body>
      </html>
    `);
    win.document.close();
  };

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <div className="w-80 border-r border-gray-800 p-6 overflow-y-auto">
        <h1 className="text-3xl font-bold mb-6 text-cyan-400">ConstructVision 3D</h1>
        <p className="mb-6">Welcome, {user.name}</p>
        
        <button 
          onClick={openFull3D}
          className="w-full py-4 bg-cyan-600 hover:bg-cyan-500 rounded-lg font-semibold mb-8"
        >
          Open Full 3D Viewer
        </button>

        <button onClick={onLogout} className="text-red-400 hover:text-red-500">Logout</button>
      </div>

      <div className="flex-1 flex items-center justify-center text-gray-400">
        Click "Open Full 3D Viewer" to start
      </div>
    </div>
  );
}