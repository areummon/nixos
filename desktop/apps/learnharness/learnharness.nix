# LearnHarness AppImage; to update: bump version, set hash = "", rebuild, paste hash from error.
{pkgs, ...}: let
  pname = "learnharness";
  version = "0.7.0";
  src = pkgs.fetchurl {
    url = "https://github.com/amosblomqvist/learnharness/releases/download/v${version}/LearnHarness-${version}-x86_64.AppImage";
    hash = "sha256-dyteBNOAy+inKnXb/yaa62pH9NRFJxGx2oBZqHIGdhM=";
  };
  contents = pkgs.appimageTools.extract {inherit pname version src;};
in {
  home.packages = [
    (pkgs.appimageTools.wrapType2 {
      inherit pname version src;
      extraInstallCommands = ''
        for f in ${contents}/*.desktop; do
          install -Dm444 "$f" $out/share/applications/${pname}.desktop
          substituteInPlace $out/share/applications/${pname}.desktop \
            --replace-quiet 'Exec=AppRun' 'Exec=${pname}'
        done
        if [ -d ${contents}/usr/share/icons ]; then
          mkdir -p $out/share
          cp -r ${contents}/usr/share/icons $out/share/
        fi
      '';
    })
  ];
}
