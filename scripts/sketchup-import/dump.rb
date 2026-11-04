# Reads the model open in SketchUp and writes it as JSON for convert.ts, with
# each texture as an image file next to it. Read only: it never starts an
# operation, never changes an entity and never saves the model.
#
# In SketchUp's Ruby console (or through the SketchUp MCP):
#   load 'D:/Pushform/Pushform/scripts/sketchup-import/dump.rb'
#   PushformDump.run('C:/path/to/output/folder')
require 'json'
require 'fileutils'

module PushformDump
  FORMAT = 'pushform-sketchup-dump'.freeze
  VERSION = 1

  def self.run(dir)
    model = Sketchup.active_model
    FileUtils.mkdir_p(dir)
    @dir = dir
    @definitions = {}
    @materials = {}
    @layers = {}
    out = {
      'format' => FORMAT,
      'version' => VERSION,
      'sketchup' => Sketchup.version,
      'title' => model.title,
      'path' => model.path,
      'units' => units(model),
      'root' => entities(model.entities),
      'definitions' => [],
      'materials' => [],
      'layers' => [],
      'unused' => 0,
    }
    # Definitions are added while entities are read; nested ones join the queue.
    done = {}
    until (pending = @definitions.keys - done.keys).empty?
      pending.each do |d|
        done[d] = true
        out['definitions'] << definition(d)
      end
    end
    out['materials'] = @materials.keys.map { |m| material(m) }
    out['layers'] = model.layers.map { |l| layer(l) }
    out['unused'] = model.definitions.count { |d| !d.image? && d.instances.empty? }
    path = File.join(dir, 'model.json')
    File.write(path, JSON.generate(out))
    summary = {
      'file' => path,
      'definitions' => out['definitions'].size,
      'faces' => out['root']['faces'].size + out['definitions'].sum { |d| d['entities']['faces'].size },
      'edges' => out['root']['edges'].size + out['definitions'].sum { |d| d['entities']['edges'].size },
      'materials' => out['materials'].size,
    }
    summary.to_json
  end

  def self.units(model)
    o = model.options['UnitsOptions']
    { 'unit' => o['LengthUnit'], 'format' => o['LengthFormat'], 'precision' => o['LengthPrecision'] }
  end

  def self.key(entity)
    entity.entityID
  end

  def self.material_ref(m)
    return nil unless m
    @materials[m] = true
    key(m)
  end

  def self.layer_ref(l)
    l ? l.name : nil
  end

  def self.definition(d)
    { 'id' => key(d), 'name' => d.name, 'group' => d.group?, 'entities' => entities(d.entities) }
  end

  def self.entities(ents)
    vertices = {}
    points = []
    vid = lambda do |v|
      vertices[v] ||= begin
        points << v.position.to_a
        points.size - 1
      end
    end
    curves = {}
    edges = ents.grep(Sketchup::Edge).map do |e|
      c = e.curve
      ci = c ? (curves[c] ||= curves.size) : nil
      {
        'v' => [vid.call(e.start), vid.call(e.end)],
        'soft' => e.soft?,
        'smooth' => e.smooth?,
        'hidden' => e.hidden?,
        'curve' => ci,
        'layer' => layer_ref(e.layer),
      }
    end
    faces = ents.grep(Sketchup::Face).map do |f|
      {
        'outer' => f.outer_loop.vertices.map { |v| vid.call(v) },
        'holes' => f.loops.reject(&:outer?).map { |l| l.vertices.map { |v| vid.call(v) } },
        'normal' => f.normal.to_a,
        'front' => material_ref(f.material),
        'back' => material_ref(f.back_material),
        'hidden' => f.hidden?,
        'layer' => layer_ref(f.layer),
      }
    end
    instances = ents.select { |e| e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance) }.map do |i|
      d = i.definition
      next nil if d.image?
      @definitions[d] = true
      {
        'definition' => key(d),
        'name' => i.name,
        'transform' => i.transformation.to_a,
        'layer' => layer_ref(i.layer),
        'material' => material_ref(i.material),
        'hidden' => i.hidden?,
      }
    end.compact
    guides = ents.grep(Sketchup::ConstructionLine).map do |g|
      { 'kind' => 'line', 'point' => g.position.to_a, 'direction' => g.direction.to_a, 'layer' => layer_ref(g.layer) }
    end
    guides += ents.grep(Sketchup::ConstructionPoint).map do |g|
      { 'kind' => 'point', 'point' => g.position.to_a, 'layer' => layer_ref(g.layer) }
    end
    dimensions = ents.grep(Sketchup::DimensionLinear).map do |d|
      { 'start' => d.start[1].to_a, 'end' => d.end[1].to_a, 'offset' => d.offset_vector.to_a, 'layer' => layer_ref(d.layer) }
    end
    texts = ents.grep(Sketchup::Text).map do |t|
      { 'point' => t.point.to_a, 'leader' => t.vector.to_a, 'text' => t.text, 'hasLeader' => t.has_leader?, 'layer' => layer_ref(t.layer) }
    end
    known = [Sketchup::Edge, Sketchup::Face, Sketchup::Group, Sketchup::ComponentInstance, Sketchup::ConstructionLine,
             Sketchup::ConstructionPoint, Sketchup::DimensionLinear, Sketchup::Text]
    other = Hash.new(0)
    ents.each do |e|
      if e.is_a?(Sketchup::ComponentInstance) && e.definition.image?
        other['Image'] += 1
      elsif known.none? { |k| e.is_a?(k) }
        other[e.typename] += 1
      end
    end
    {
      'vertices' => points,
      'edges' => edges,
      'curves' => curves.keys.map { |c| curve(c) },
      'faces' => faces,
      'instances' => instances,
      'guides' => guides,
      'dimensions' => dimensions,
      'texts' => texts,
      'other' => other,
    }
  end

  def self.curve(c)
    out = { 'arc' => c.is_a?(Sketchup::ArcCurve), 'segments' => c.edges.size }
    return out unless out['arc']
    out.merge(
      'center' => c.center.to_a,
      'normal' => c.normal.to_a,
      'radius' => c.radius.to_f,
      'xaxis' => c.xaxis.to_a,
      'yaxis' => c.yaxis.to_a,
      'start' => c.start_angle,
      'end' => c.end_angle,
      'polygon' => c.respond_to?(:is_polygon?) ? c.is_polygon? : false,
    )
  end

  def self.material(m)
    out = {
      'id' => key(m),
      'name' => m.display_name,
      'color' => m.color.to_a.first(3),
      'alpha' => m.alpha,
      'texture' => nil,
    }
    t = m.texture
    if t
      file = File.join(@dir, "texture-#{key(m)}.png")
      saved = false
      begin
        if t.respond_to?(:image_rep)
          t.image_rep.save_file(file)
          saved = true
        elsif t.respond_to?(:write)
          saved = t.write(file)
        end
      rescue StandardError
        saved = false
      end
      out['texture'] = { 'file' => saved ? File.basename(file) : nil, 'width' => t.width, 'height' => t.height, 'source' => t.filename }
    end
    out
  end

  def self.layer(l)
    folder_hidden = false
    f = l.respond_to?(:folder) ? l.folder : nil
    while f
      folder_hidden ||= !f.visible?
      f = f.respond_to?(:folder) ? f.folder : nil
    end
    { 'name' => l.name, 'visible' => l.visible? && !folder_hidden, 'color' => l.color.to_a.first(3), 'default' => l == l.model.layers[0] }
  end
end
