{
  description = "A very basic flake";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    git-hooks.url = "github:cachix/git-hooks.nix";
    treefmt-nix.url = "github:numtide/treefmt-nix";
  };

  outputs =
    {
      self,
      nixpkgs,
      treefmt-nix,
      ...
    }@inputs:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      treefmtEvalFor =
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        treefmt-nix.lib.evalModule pkgs {
          projectRootFile = "flake.nix"; # tells treefmt where repo root is

          programs = {
            nixfmt.enable = true; # uses nixfmt from pkgs
            shfmt.enable = true;
            oxfmt.enable = true;
          };

          settings = {
            formatter = {
              shfmt = {
                options = [
                  "-i"
                  "2"
                  "-s"
                  "-w"
                ];
              };
              oxfmt = {
                includes = [
                  "*.md"
                  "*.yaml"
                  "*.yml"
                  "*.json"
                  "*.html"
                  "*.css"
                  "*.js"
                  "*.ts"
                  "*.tsx"
                  "*.svelte"
                ];
              };
            };
          };
        };
    in
    {
      formatter = forAllSystems (system: (treefmtEvalFor system).config.build.wrapper);

      checks = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          pre-commit-check = inputs.git-hooks.lib.${system}.run {
            src = ./.;
            hooks = {
              treefmt = {
                enable = true;
                entry = "${(treefmtEvalFor system).config.build.wrapper}/bin/treefmt";
              };
              gitlint.enable = true;

              gitleaks = {
                enable = true;
                entry = "${pkgs.gitleaks}/bin/gitleaks git";
                pass_filenames = false;
              };

              tests = {
                enable = true;
                entry = "echo 'No tests defined yet.'";
                stages = [
                  "pre-push"
                ];
              };
            };
          };
        }
      );

      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          inherit (self.checks.${system}.pre-commit-check) shellHook enabledPackages;
          customShellHook = shellHook + "";

        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              go
              bun
              gitlint
            ];

            inherit customShellHook;
            buildInputs = enabledPackages;
          };
        }
      );
    };
}
