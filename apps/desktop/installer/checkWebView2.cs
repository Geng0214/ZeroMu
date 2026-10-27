using System;
using System.Runtime.InteropServices;

internal static class checkWebView2
{
    // ACT: URL.canParse 需要 Chromium 120；同时覆盖 Map.groupBy 和 Promise.withResolvers。
    private static readonly Version minimumVersion = new Version(120, 0, 0, 0);

    [DllImport("WebView2Loader.dll", EntryPoint = "GetAvailableCoreWebView2BrowserVersionString",
        CharSet = CharSet.Unicode,
        ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    private static extern int getAvailableVersion(
        string browserExecutableFolder, out IntPtr versionInfo);

    // ACT: WebView2 官方比较规则忽略 beta/dev/canary 通道后缀，比较失败仍按不可用处理，交给安装器补装运行时。
    [DllImport("WebView2Loader.dll", EntryPoint = "CompareBrowserVersions",
        CharSet = CharSet.Unicode,
        ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    private static extern int compareVersions(
        string version1, string version2, out int result);

    private static int Main()
    {
        IntPtr versionInfo = IntPtr.Zero;
        try
        {
            int result = getAvailableVersion(null, out versionInfo);
            string version = versionInfo == IntPtr.Zero
                ? null : Marshal.PtrToStringUni(versionInfo);
            int comparison = 0;
            if (result >= 0) result = compareVersions(version, "0.0.0.0", out comparison);
            if (result < 0 || comparison <= 0)
            {
                Console.WriteLine("WebView2 Runtime unavailable: HRESULT=0x"
                    + result.ToString("X8") + "; version=" + (version ?? "<none>")
                    + "; required>=" + minimumVersion);
                return 1;
            }

            result = compareVersions(version, minimumVersion.ToString(), out comparison);
            if (result < 0)
            {
                Console.WriteLine("WebView2 Runtime version comparison failed: HRESULT=0x"
                    + result.ToString("X8") + "; version=" + version
                    + "; required>=" + minimumVersion);
                return 1;
            }
            if (comparison < 0)
            {
                Console.WriteLine("WebView2 Runtime outdated: version=" + version
                    + "; required>=" + minimumVersion);
                return 3;
            }
            Console.WriteLine("WebView2 Runtime available: " + version);
            return 0;
        }
        catch (Exception error)
        {
            Console.WriteLine("WebView2 check failed: " + error.GetType().Name
                + ": " + error.Message);
            return 2;
        }
        finally
        {
            if (versionInfo != IntPtr.Zero)
                Marshal.FreeCoTaskMem(versionInfo);
        }
    }
}
