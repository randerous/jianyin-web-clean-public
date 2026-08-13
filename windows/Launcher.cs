using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class Launcher
{
    private const string RuntimeVersion = "1.0.32";
    private const string NodeVersion = "22.17.0";
    private const string NodeSha256 = "721ab118a3aac8584348b132767eadf51379e0616f0db802cc1e66d7f0d98f85";
    private const string LatestReleaseUrl = "https://api.github.com/repos/randerous/jianyin-web-clean-public/releases/latest";
    private const int UpdateRestartExitCode = 75;
    private static readonly string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Jianyin");
    private static readonly string PortFile = Path.Combine(DataDir, "active-port.txt");

    [STAThread]
    private static void Main()
    {
        // GitHub 仅支持 TLS 1.2+；.NET 4.0 语义默认不含 TLS 1.2，
        // 不显式启用则 WebClient 报"未能创建 SSL/TLS 安全通道"。
        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;
        Directory.CreateDirectory(DataDir);
        bool ownsMutex;
        using (var mutex = new Mutex(true, "Local\\Randerous.Jianyin.Launcher", out ownsMutex))
        {
            if (!ownsMutex)
            {
                OpenExistingInstance();
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new TrayApplicationContext());
        }
    }

    private static void OpenExistingInstance()
    {
        int port;
        if (File.Exists(PortFile) && int.TryParse(File.ReadAllText(PortFile), out port)) OpenBrowser(port);
    }

    private static void OpenBrowser(int port)
    {
        Process.Start(new ProcessStartInfo("http://127.0.0.1:" + port + "/") { UseShellExecute = true });
    }

    private sealed class TrayApplicationContext : ApplicationContext
    {
        private readonly NotifyIcon tray;
        private Process server;
        private int port;
        private bool launcherUpdateRequested;

        internal TrayApplicationContext()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("打开既见", null, delegate { if (port > 0) OpenBrowser(port); });
            menu.Items.Add("检查更新", null, delegate { ThreadPool.QueueUserWorkItem(_ => UpdateAndNotify()); });
            menu.Items.Add("重启服务", null, delegate { ThreadPool.QueueUserWorkItem(_ => Restart()); });
            menu.Items.Add("退出", null, delegate { ExitThread(); });
            tray = new NotifyIcon
            {
                Icon = SystemIcons.Application,
                Text = "既见",
                ContextMenuStrip = menu,
                Visible = true
            };
            tray.DoubleClick += delegate { if (port > 0) OpenBrowser(port); };
            ThreadPool.QueueUserWorkItem(_ => Start());
        }

        private void Start()
        {
            try
            {
                if (launcherUpdateRequested)
                {
                    launcherUpdateRequested = false;
                    var updateResult = TryStageLauncherUpdate();
                    if (updateResult == LauncherUpdateResult.RestartScheduled)
                    {
                        ExitThread();
                        return;
                    }
                    if (updateResult == LauncherUpdateResult.Failed) Log("桌面版自动更新失败；继续启动当前版本");
                }
                TryFastForwardUpdate();
                var runtimeDir = EnsureRuntime();
                var nodeExe = EnsureNode();
                StartServer(nodeExe, runtimeDir);
                if (!WaitUntilHealthy()) throw new InvalidOperationException("本地服务启动超时");
                File.WriteAllText(PortFile, port.ToString());
                if (Environment.GetEnvironmentVariable("JIANYIN_LAUNCHER_SMOKE") == "1")
                {
                    ExitThread();
                    return;
                }
                OpenBrowser(port);
                ShowMessage("既见已在后台运行", ToolTipIcon.Info);
            }
            catch (Exception error)
            {
                Log(error.ToString());
                ShowMessage("启动失败，请查看日志：" + LogPath(), ToolTipIcon.Error);
                ExitThread();
            }
        }

        private string EnsureRuntime()
        {
            var target = Path.Combine(DataDir, "runtime", RuntimeVersion, "app");
            var marker = Path.Combine(target, ".ready");
            if (File.Exists(marker)) return target;
            var parent = Directory.GetParent(target).FullName;
            if (Directory.Exists(parent)) Directory.Delete(parent, true);
            Directory.CreateDirectory(target);
            using (var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("JianyinRuntime"))
            {
                if (resource == null) throw new InvalidOperationException("EXE 中缺少运行资源");
                using (var archive = new ZipArchive(resource, ZipArchiveMode.Read)) archive.ExtractToDirectory(target);
            }
            File.WriteAllText(marker, RuntimeVersion);
            return target;
        }

        private string EnsureNode()
        {
            var nodeDir = Path.Combine(DataDir, "runtime", "node-v" + NodeVersion + "-win-x64");
            var nodeExe = Path.Combine(nodeDir, "node.exe");
            if (File.Exists(nodeExe)) return nodeExe;
            var zip = Path.Combine(DataDir, "node-v" + NodeVersion + "-win-x64.zip");
            using (var client = new WebClient()) client.DownloadFile("https://nodejs.org/dist/v" + NodeVersion + "/node-v" + NodeVersion + "-win-x64.zip", zip);
            using (var stream = File.OpenRead(zip))
            using (var sha = SHA256.Create())
            {
                var actual = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
                if (actual != NodeSha256) throw new InvalidDataException("Node.js 下载校验失败");
            }
            ZipFile.ExtractToDirectory(zip, Path.Combine(DataDir, "runtime"));
            File.Delete(zip);
            return nodeExe;
        }

        private void StartServer(string nodeExe, string runtimeDir)
        {
            port = FindPort();
            var logs = Path.Combine(DataDir, "logs");
            Directory.CreateDirectory(logs);
            var info = new ProcessStartInfo(nodeExe, "\"" + Path.Combine(runtimeDir, "server.mjs") + "\" --port " + port)
            {
                WorkingDirectory = runtimeDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            info.EnvironmentVariables["JIANYIN_STATE_PATH"] = Path.Combine(DataDir, "state.json");
            info.EnvironmentVariables["JIANYIN_ENABLE_UPDATE"] = "1";
            info.EnvironmentVariables["JIANYIN_UPDATE_ROOT"] = AppDomain.CurrentDomain.BaseDirectory;
            info.EnvironmentVariables["JIANYIN_PACKAGED_LAUNCHER"] = "1";
            server = Process.Start(info);
            var launchedServer = server;
            launchedServer.EnableRaisingEvents = true;
            launchedServer.Exited += delegate
            {
                if (launchedServer.ExitCode != UpdateRestartExitCode || server != launchedServer) return;
                launcherUpdateRequested = true;
                server = null;
                ThreadPool.QueueUserWorkItem(delegate
                {
                    Thread.Sleep(300);
                    Start();
                });
            };
            server.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) Log(e.Data); };
            server.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) Log(e.Data); };
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();
        }

        private bool WaitUntilHealthy()
        {
            for (var i = 0; i < 80; i++)
            {
                if (server == null || server.HasExited) return false;
                try
                {
                    using (var client = new WebClient())
                    {
                        if (client.DownloadString("http://127.0.0.1:" + port + "/api/health").Contains("\"ok\":true")) return true;
                    }
                }
                catch { }
                Thread.Sleep(250);
            }
            return false;
        }

        private static int FindPort()
        {
            for (var candidate = 5188; candidate < 5288; candidate++)
            {
                try
                {
                    var listener = new TcpListener(IPAddress.Loopback, candidate);
                    listener.Start();
                    listener.Stop();
                    return candidate;
                }
                catch (SocketException) { }
            }
            throw new InvalidOperationException("没有可用的本地端口");
        }

        private void Restart()
        {
            StopServer();
            Start();
        }

        private void UpdateAndNotify()
        {
            var result = TryStageLauncherUpdate();
            if (result == LauncherUpdateResult.RestartScheduled)
            {
                ShowMessage("桌面版正在更新，启动器将自动重启", ToolTipIcon.Info);
                ExitThread();
                return;
            }
            ShowMessage(result == LauncherUpdateResult.UpToDate ? "当前已是最新版本" : "桌面版更新失败，请查看日志", result == LauncherUpdateResult.UpToDate ? ToolTipIcon.Info : ToolTipIcon.Error);
        }

        private enum LauncherUpdateResult
        {
            UpToDate,
            RestartScheduled,
            Failed
        }

        [DataContract]
        private sealed class GithubRelease
        {
            [DataMember(Name = "tag_name")]
            public string TagName;

            [DataMember(Name = "assets")]
            public GithubAsset[] Assets;
        }

        [DataContract]
        private sealed class GithubAsset
        {
            [DataMember(Name = "name")]
            public string Name;

            [DataMember(Name = "browser_download_url")]
            public string BrowserDownloadUrl;

            [DataMember(Name = "digest")]
            public string Digest;
        }

        private static LauncherUpdateResult TryStageLauncherUpdate()
        {
            try
            {
                GithubRelease release;
                using (var client = new WebClient())
                {
                    client.Headers[HttpRequestHeader.Accept] = "application/vnd.github+json";
                    client.Headers[HttpRequestHeader.UserAgent] = "jianyin-windows-updater";
                    var serializer = new DataContractJsonSerializer(typeof(GithubRelease));
                    using (var json = new MemoryStream(Encoding.UTF8.GetBytes(client.DownloadString(LatestReleaseUrl))))
                    {
                        release = (GithubRelease)serializer.ReadObject(json);
                    }
                }

                var latestVersion = NormalizeReleaseVersion(release == null ? null : release.TagName);
                if (latestVersion == null || CompareVersions(latestVersion, RuntimeVersion) <= 0) return LauncherUpdateResult.UpToDate;
                var asset = FindLauncherAsset(release.Assets);
                var digest = NormalizeSha256(asset == null ? null : asset.Digest);
                if (asset == null || digest == null || !IsAllowedReleaseUrl(asset.BrowserDownloadUrl)) return LauncherUpdateResult.Failed;

                var updateDir = Path.Combine(DataDir, "updates");
                Directory.CreateDirectory(updateDir);
                var staged = Path.Combine(updateDir, "jianyin-windows-launcher-" + latestVersion + ".exe");
                using (var client = new WebClient())
                {
                    client.Headers[HttpRequestHeader.UserAgent] = "jianyin-windows-updater";
                    client.DownloadFile(asset.BrowserDownloadUrl, staged);
                }
                if (!string.Equals(HashFile(staged), digest, StringComparison.OrdinalIgnoreCase))
                {
                    File.Delete(staged);
                    Log("Windows launcher 更新包 SHA-256 校验失败");
                    return LauncherUpdateResult.Failed;
                }

                var script = Path.Combine(updateDir, "apply-launcher-update.cmd");
                var scriptText = "@echo off\r\n"
                    + "setlocal\r\n"
                    + "timeout /t 2 /nobreak >nul\r\n"
                    + "copy /y \"%JIANYIN_UPDATE_SOURCE%\" \"%JIANYIN_UPDATE_TARGET%\" >nul\r\n"
                    + "if not errorlevel 1 goto updated\r\n"
                    + "start \"\" \"%JIANYIN_UPDATE_TARGET%\"\r\n"
                    + "exit /b 1\r\n"
                    + ":updated\r\n"
                    + "del /q \"%JIANYIN_UPDATE_SOURCE%\" >nul 2>&1\r\n"
                    + "start \"\" \"%JIANYIN_UPDATE_TARGET%\"\r\n"
                    + "del /q \"%~f0\" >nul 2>&1\r\n";
                File.WriteAllText(script, scriptText, Encoding.ASCII);
                var updater = new ProcessStartInfo("cmd.exe", "/d /c \"" + script + "\"")
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                updater.EnvironmentVariables["JIANYIN_UPDATE_SOURCE"] = staged;
                updater.EnvironmentVariables["JIANYIN_UPDATE_TARGET"] = Application.ExecutablePath;
                Process.Start(updater);
                return LauncherUpdateResult.RestartScheduled;
            }
            catch (Exception error)
            {
                Log("Windows launcher 更新失败：" + error.Message);
                return LauncherUpdateResult.Failed;
            }
        }

        private static GithubAsset FindLauncherAsset(GithubAsset[] assets)
        {
            if (assets == null) return null;
            foreach (var asset in assets)
            {
                if (asset != null && string.Equals(asset.Name, "jianyin-windows-launcher.exe", StringComparison.Ordinal)) return asset;
            }
            return null;
        }

        private static string NormalizeReleaseVersion(string tag)
        {
            if (string.IsNullOrEmpty(tag) || !tag.StartsWith("v", StringComparison.Ordinal)) return null;
            var version = tag.Substring(1);
            Version parsed;
            return Version.TryParse(version, out parsed) && parsed.Build >= 0 && parsed.Revision < 0 ? version : null;
        }

        private static int CompareVersions(string left, string right)
        {
            Version leftVersion;
            Version rightVersion;
            if (!Version.TryParse(left, out leftVersion) || !Version.TryParse(right, out rightVersion)) return -1;
            return leftVersion.CompareTo(rightVersion);
        }

        private static string NormalizeSha256(string digest)
        {
            if (string.IsNullOrEmpty(digest)) return null;
            var normalized = digest.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase) ? digest.Substring(7) : digest;
            if (normalized.Length != 64) return null;
            foreach (var character in normalized)
            {
                if (!Uri.IsHexDigit(character)) return null;
            }
            return normalized.ToLowerInvariant();
        }

        private static bool IsAllowedReleaseUrl(string value)
        {
            Uri uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri) || uri.Scheme != Uri.UriSchemeHttps) return false;
            return string.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase)
                || string.Equals(uri.Host, "objects.githubusercontent.com", StringComparison.OrdinalIgnoreCase)
                || string.Equals(uri.Host, "release-assets.githubusercontent.com", StringComparison.OrdinalIgnoreCase);
        }

        private static string HashFile(string path)
        {
            using (var stream = File.OpenRead(path))
            using (var sha = SHA256.Create())
            {
                return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            }
        }

        private static bool TryFastForwardUpdate()
        {
            var root = AppDomain.CurrentDomain.BaseDirectory;
            if (!Directory.Exists(Path.Combine(root, ".git"))) return false;
            if (RunGit(root, "status --porcelain").Trim().Length != 0) return false;
            return RunGit(root, "pull --ff-only").IndexOf("fatal:", StringComparison.OrdinalIgnoreCase) < 0;
        }

        private static string RunGit(string root, string arguments)
        {
            try
            {
                var info = new ProcessStartInfo("git", arguments) { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
                using (var process = Process.Start(info))
                {
                    var output = process.StandardOutput.ReadToEnd() + process.StandardError.ReadToEnd();
                    if (!process.WaitForExit(15000)) process.Kill();
                    return output;
                }
            }
            catch { return "fatal:"; }
        }

        private void ShowMessage(string message, ToolTipIcon icon)
        {
            if (tray != null) tray.ShowBalloonTip(3000, "既见", message, icon);
        }

        private static string LogPath() { return Path.Combine(DataDir, "logs", "launcher.log"); }
        private static void Log(string message)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LogPath()));
            File.AppendAllText(LogPath(), DateTime.Now.ToString("s") + " " + message + Environment.NewLine);
        }

        private void StopServer()
        {
            if (server != null && !server.HasExited) server.Kill();
            server = null;
            if (File.Exists(PortFile)) File.Delete(PortFile);
        }

        protected override void ExitThreadCore()
        {
            StopServer();
            tray.Visible = false;
            tray.Dispose();
            base.ExitThreadCore();
        }
    }
}
