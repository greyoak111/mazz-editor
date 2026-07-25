require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'MazzTcpServer'
  s.version = package['version']
  s.summary = package['description']
  s.license = 'MIT'
  s.homepage = 'https://github.com/greyoak111/mazz-editor'
  s.author = 'greyoak111'
  s.source = { :git => 'https://github.com/greyoak111/mazz-editor.git', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m}'
  s.ios.deployment_target = '14.0'
  s.swift_version = '5.1'
  s.dependency 'Capacitor'
end
