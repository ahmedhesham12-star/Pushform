# Builds a small test model in an empty, untitled SketchUp model, dumps it with
# dump.rb, writes a picture, then aborts the operation so the model is left as
# it was. It refuses to run on a model that is not empty.
#   load 'D:/Pushform/Pushform/scripts/sketchup-import/test-model.rb'
#   PushformTest.run('C:/path/to/output/folder')
require 'json'
load File.join(__dir__, 'dump.rb')

module PushformTest
  PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='.freeze

  def self.up(face)
    face.reverse! if face.normal.z < 0
    face
  end

  def self.box(ents, w, d, h)
    up(ents.add_face([0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0])).pushpull(h)
  end

  def self.build(m, dir)
    ents = m.entities
    case_tag = m.layers.add('Case')
    case_tag.visible = false
    shelf_tag = m.layers.add('Shelves')
    oak = m.materials.add('Oak')
    oak.color = Sketchup::Color.new(180, 140, 90)
    navy = m.materials.add('Navy')
    navy.color = Sketchup::Color.new(30, 40, 90)
    glass = m.materials.add('Glass')
    glass.color = Sketchup::Color.new(150, 200, 220)
    glass.alpha = 0.4
    png = File.join(dir, 'walnut-source.png')
    File.binwrite(png, PNG.unpack1('m'))
    walnut = m.materials.add('Walnut')
    walnut.texture = png
    walnut.texture.size = [24, 12]

    # A box with a round hole through it.
    ring = up(ents.add_face([0, 0, 0], [600.mm, 0, 0], [600.mm, 400.mm, 0], [0, 400.mm, 0]))
    ents.add_circle([300.mm, 200.mm, 0], Z_AXIS, 100.mm, 24)
    disc = ents.grep(Sketchup::Face).min_by(&:area)
    disc.erase!
    ring = ents.grep(Sketchup::Face).first
    up(ring).pushpull(300.mm)

    # A cylinder with a see-through top, a hexagon and a loose arc.
    cyl = up(ents.add_face(ents.add_circle([1000.mm, 200.mm, 0], Z_AXIS, 80.mm, 24)))
    cyl.pushpull(400.mm)
    ents.grep(Sketchup::Face).find { |f| f.normal.z > 0.99 && (f.bounds.center.z - 400.mm).abs < 0.01 }.material = glass
    up(ents.add_face(ents.add_ngon([1300.mm, 200.mm, 0], Z_AXIS, 80.mm, 6)))
    ents.add_arc([0, -300.mm, 0], X_AXIS, Z_AXIS, 200.mm, 0, Math::PI, 12)
    ents.add_line([0, -600.mm, 0], [300.mm, -600.mm, 0]).hidden = true

    # A component, painted front and back, placed plain and mirrored.
    side = m.definitions.add('Side')
    box(side.entities, 18.mm, 400.mm, 700.mm)
    side.entities.grep(Sketchup::Face).find { |f| f.normal.z > 0.99 }.material = oak
    side.entities.grep(Sketchup::Face).find { |f| f.normal.x > 0.99 }.back_material = navy
    left = ents.add_instance(side, Geom::Transformation.new([1500.mm, 0, 0]))
    left.name = 'Left side'
    left.material = walnut
    right = ents.add_instance(side, Geom::Transformation.new([2200.mm, 0, 0]) * Geom::Transformation.scaling(-1, 1, 1))
    right.name = 'Right side'
    right.layer = case_tag

    # A stretched group and its copy, and a group holding the component.
    shelf = ents.add_group
    box(shelf.entities, 300.mm, 300.mm, 18.mm)
    shelf.transform!(Geom::Transformation.new([0, 1000.mm, 0]) * Geom::Transformation.scaling(2, 1, 1))
    shelf.name = 'Shelf'
    shelf.layer = shelf_tag
    copy = shelf.copy
    copy.transform!(Geom::Transformation.new([0, 0, 200.mm]))
    copy.name = 'Shelf copy'
    cabinet = ents.add_group
    cabinet.entities.add_instance(side, Geom::Transformation.new([0, 0, 0]))
    cabinet.transform!(Geom::Transformation.new([3000.mm, 0, 0]))
    cabinet.name = 'Cabinet'

    # Guides and annotations.
    ents.add_cline(ORIGIN, Y_AXIS)
    ents.add_cpoint([100.mm, 100.mm, 500.mm])
    ents.add_dimension_linear([0, 0, 0], [600.mm, 0, 0], [0, -200.mm, 0])
    ents.add_text('Corner', [600.mm, 400.mm, 300.mm], [100.mm, 100.mm, 100.mm])
  end

  # What SketchUp holds, to compare with the converted file.
  def self.counts(m)
    count = lambda do |ents|
      {
        'faces' => ents.grep(Sketchup::Face).size,
        'holes' => ents.grep(Sketchup::Face).sum { |f| f.loops.size - 1 },
        'edges' => ents.grep(Sketchup::Edge).size,
        'soft' => ents.grep(Sketchup::Edge).count(&:soft?),
        'curves' => ents.grep(Sketchup::Edge).map(&:curve).compact.uniq.size,
      }
    end
    out = { 'Model' => count.call(m.entities) }
    m.definitions.each { |d| out[d.group? ? "group #{d.instances.map(&:name).join('/')}" : d.name] = count.call(d.entities) unless d.image? }
    out
  end

  def self.run(dir)
    m = Sketchup.active_model
    raise 'not an empty, untitled model' unless m.path.empty? && m.entities.size.zero? && m.definitions.size.zero?

    FileUtils.mkdir_p(dir)
    view = m.active_view
    cam = view.camera
    saved = Sketchup::Camera.new(cam.eye, cam.target, cam.up, cam.perspective?, cam.fov)
    m.start_operation('Pushform converter test', true)
    begin
      build(m, dir)
      summary = JSON.parse(PushformDump.run(dir))
      counts = counts(m)
      view.zoom_extents
      view.write_image(File.join(dir, 'sketchup.png'), 1400, 900, true)
      { 'dump' => summary, 'sketchup' => counts }.to_json
    ensure
      m.abort_operation
      view.camera = saved
    end
  end
end
