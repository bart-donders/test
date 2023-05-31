// See https://aka.ms/new-console-template for more information

using TestConsoleApp;

string message = "Hello, World!";

message = TestConsoleAppHelper.AddExclamationMark(message);

//Debug.WriteLine(message);
//Debug.Assert(false, "Test Debug.Assert");

Console.WriteLine(message);
