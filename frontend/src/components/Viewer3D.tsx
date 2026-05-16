import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, Grid } from '@react-three/drei';

interface Props {
  layers: { [key: string]: boolean };
  extractedData: any;
  customMaterials?: any;
}

function SteelBuildingViewer({ layers, extractedData, customMaterials }: Props) {
  // 30' x 60' building from your spec
  const width = 66;   // scaled for visuals
  const length = 132;
  const height = 18;

  const mat = customMaterials || {
    wallColor: "#a8b8c8",
    roofColor: "#2a2a2a",
    frameColor: "#555555"
  };

  return (
    <>
      {layers.site && (
        <>
          <mesh position={[0, -5, 0]} rotation={[-Math.PI * 0.5, 0, 0]} receiveShadow>
            <planeGeometry args={[250, 350]} />
            <meshStandardMaterial color="#0f1a0f" roughness={1} />
          </mesh>
          <Grid args={[220, 320]} position={[0, -4.9, 0]} cellSize={6} cellThickness={0.7} sectionSize={30} fadeDistance={250} />
        </>
      )}

      {layers.foundation && (
        <mesh position={[0, 0, 0]} receiveShadow>
          <boxGeometry args={[width + 8, 3.5, length + 8]} />
          <meshStandardMaterial color="#444444" roughness={0.9} />
        </mesh>
      )}

      {layers.framing && (
        <group>
          {/* Main Steel Building */}
          <mesh position={[0, height/2 + 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[width, height, length]} />
            <meshStandardMaterial color={mat.wallColor} metalness={0.45} roughness={0.5} />
          </mesh>

          {/* Roof */}
          <mesh position={[0, height + 5.5, 0]} rotation={[0.22, 0, 0]} castShadow>
            <boxGeometry args={[width + 6, 3, length + 6]} />
            <meshStandardMaterial color={mat.roofColor} metalness={0.75} roughness={0.4} />
          </mesh>

          {/* Portal Frames (CEE Columns) */}
          {Array.from({ length: 7 }).map((_, i) => {
            const x = -width/2 + (i * (width / 6));
            return (
              <group key={i}>
                <mesh position={[x, height/2, -length/2 + 4]} castShadow>
                  <cylinderGeometry args={[1.1, 1.1, height + 6, 24]} />
                  <meshStandardMaterial color={mat.frameColor} metalness={0.95} roughness={0.3} />
                </mesh>
                <mesh position={[x, height/2, length/2 - 4]} castShadow>
                  <cylinderGeometry args={[1.1, 1.1, height + 6, 24]} />
                  <meshStandardMaterial color={mat.frameColor} metalness={0.95} roughness={0.3} />
                </mesh>
              </group>
            );
          })}
        </group>
      )}

      {layers.envelope && (
        <mesh position={[0, height/2 + 2, 0]}>
          <boxGeometry args={[width + 0.8, height, length + 0.8]} />
          <meshStandardMaterial color="#b0c8e0" metalness={0.6} roughness={0.45} transparent opacity={0.9} />
        </mesh>
      )}
    </>
  );
}

export default function Viewer3D({ layers, extractedData, customMaterials }: Props) {
  return (
    <Canvas 
      camera={{ position: [150, 110, 150], fov: 35 }} 
      style={{ background: '#03050f' }}
      shadows
    >
      <ambientLight intensity={0.55} />
      <pointLight position={[170, 200, 150]} intensity={3.5} castShadow />
      <directionalLight position={[100, 160, 90]} intensity={2.2} castShadow />

      <SteelBuildingViewer layers={layers} extractedData={extractedData} customMaterials={customMaterials} />

      <OrbitControls target={[0, 22, 0]} minDistance={35} maxDistance={900} enableDamping dampingFactor={0.08} />
      <Environment preset="warehouse" />
    </Canvas>
  );
}