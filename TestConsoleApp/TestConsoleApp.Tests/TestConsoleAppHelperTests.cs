namespace TestConsoleApp.Tests
{
    using TestConsoleApp;

    [TestClass]
    public class TestConsoleAppHelperTests
    {
        [TestMethod]
        public void test_null_input()
        {
            // Arrange
            string? input = null;
            // Act
            string output = TestConsoleAppHelper.AddExclamationMark(input);
            //Assert
            Assert.AreEqual(output, "?");
        }

        [TestMethod]
        public void test_empty_input()
        {
            // Arrange
            string? input = "";
            // Act
            string output = TestConsoleAppHelper.AddExclamationMark(input);
            //Assert
            Assert.AreEqual(output, "?");
        }

        [TestMethod]
        public void test_exclamation_input()
        {
            // Arrange
            string? input = "Howdy!";
            // Act
            string output = TestConsoleAppHelper.AddExclamationMark(input);
            //Assert
            Assert.AreEqual(output, input);
        }

        [TestMethod]
        public void test_non_exclamation_input()
        {
            // Arrange
            string? input = "Howdy";
            // Act
            string output = TestConsoleAppHelper.AddExclamationMark(input);
            //Assert
            Assert.AreEqual(output, "Howdy!");
        }
    }
}
