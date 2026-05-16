interface Props {
  layers: { [key: string]: boolean };
  setLayers: React.Dispatch<React.SetStateAction<{ [key: string]: boolean }>>;
}

export default function LayerControls({ layers, setLayers }: Props) {
  const toggleLayer = (key: string) => {
    setLayers(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const layerNames: Record<string, string> = {
    site: "Site & Excavation",
    utilities: "Underground Utilities",
    foundation: "Foundation",
    framing: "Main Framing",
    secondary: "Secondary Framing",
    envelope: "Envelope & Sheeting"
  };

  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">Layer Controls</h3>
      <div className="space-y-3">
        {Object.keys(layers).map(key => (
          <label key={key} className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={layers[key]}
              onChange={() => toggleLayer(key)}
              className="w-5 h-5 accent-cyan-500"
            />
            <span>{layerNames[key] || key}</span>
          </label>
        ))}
      </div>
    </div>
  );
}