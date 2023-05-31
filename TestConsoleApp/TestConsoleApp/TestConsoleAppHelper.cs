namespace TestConsoleApp
{
    public static class TestConsoleAppHelper
    {
        public static string AddExclamationMark(string? input)
        {
            if (input == null) { return "?"; }
            if (input.Length == 0) { return "?"; }
            if (input.EndsWith('!')) { return input; }

            return input + "!";
        }
    }
}
